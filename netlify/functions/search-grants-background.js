const { getStore, connectLambda } = require("@netlify/blobs");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function buildCacheKey(filters) {
  const location = filters.location || 'both';
  const discipline = filters.discipline || 'both';
  return `cache:${location}:${discipline}`;
}

exports.handler = async function (event, context) {
  // REQUIRED in Lambda-compatibility mode (classic exports.handler functions) —
  // without this, getStore() throws on every single invocation.
  connectLambda(event);

  const store = getStore({ name: "grant-jobs" });

  let jobId;
  try {
    const body = JSON.parse(event.body);
    jobId = body.jobId;
    const filters = body.filters;

    if (!jobId) {
      console.log("No jobId provided, aborting");
      return;
    }

    console.log(`[${jobId}] Background search started. Filters:`, filters);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await store.setJSON(jobId, { status: "error", error: "ANTHROPIC_API_KEY not set" });
      return;
    }

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().toLocaleString('default', { month: 'long' });

    let locationText = 'Both Australia and International';
    if (filters.location === 'australia') locationText = 'Australia';
    else if (filters.location === 'international') locationText = 'International (outside Australia)';

    let disciplineText = 'Business and Law (both fields, or closely related social sciences)';
    if (filters.discipline === 'business') disciplineText = 'Business only (not Law)';
    else if (filters.discipline === 'law') disciplineText = 'Law only (not Business)';

    const initialPrompt = `Search for current grant opportunities for Early Career Researchers in ${filters.discipline === 'business' ? 'Business' : filters.discipline === 'law' ? 'Law' : 'Business and Law'}. Find grants that are currently open (closing date has not passed, currently accepting applications in ${currentMonth} ${currentYear}).

Location focus: ${locationText}
Discipline focus: ${disciplineText}

Prioritize checking well-known grant sources where relevant, such as GrantConnect (grants.gov.au), the Australian Research Council (arc.gov.au), university research offices (e.g. Edith Cowan University, UWA, Melbourne, UNSW), and relevant philanthropic or industry funding bodies, alongside general web search.

For each grant found, extract:
1. Grant name/title
2. Funding body/organization
3. Amount/funding range
4. Closing date (must be in the future) — use a clear, unambiguous format like "15 March 2027"
5. Eligibility criteria (especially for Early Career Researchers)
6. Success rate if available
7. URL/link to apply
8. Geographic focus (Australia or international)

After searching, output ONLY a JSON array — no markdown fences, no preamble, no closing remarks:
[{
  "name": "Grant Name",
  "organization": "Funding Body",
  "amount": "Amount range or specific amount",
  "closingDate": "Date string, e.g. 15 March 2027",
  "eligibility": "Brief eligibility summary",
  "successRate": "Percentage or 'Not available'",
  "url": "Application URL",
  "location": "Australia or International or Specific country",
  "description": "Brief description"
}]

Find up to 4 grants matching the discipline focus above. Only include grants with future closing dates.

If you can only find 1, 2, or 3 grants that genuinely meet these criteria, return just those — do not pad the list with grants that don't fit (wrong field, or closing date already passed). If you find zero qualifying grants, return an empty array: []

CRITICAL: Your response must ALWAYS be a JSON array, even if empty. Never respond with a prose explanation of why you couldn't find grants instead of JSON — an empty array [] is a perfectly valid and expected answer when the search space is genuinely limited right now.

Do this efficiently — use at most 2 searches total, then write your final JSON answer.`;

    let messages = [{ role: "user", content: initialPrompt }];
    let finalData = null;
    const MAX_CONTINUATIONS = 2;

    for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
      console.log(`[${jobId}] API call attempt ${attempt + 1} starting at`, new Date().toISOString());

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s per attempt

      let response;
      try {
        response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01"
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 8000,
            tools: [{
              type: "web_search_20250305",
              name: "web_search",
              max_uses: 2
            }],
            messages
          })
        });
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        if (fetchErr.name === 'AbortError') {
          console.log(`[${jobId}] Attempt ${attempt + 1} timed out after 90s`);
          await store.setJSON(jobId, {
            status: "error",
            error: `The AI call itself hung for over 90 seconds on attempt ${attempt + 1} and was aborted. This points to a network/API issue rather than a slow search.`
          });
          return;
        }
        throw fetchErr;
      }
      clearTimeout(timeoutId);

      console.log(`[${jobId}] API response status:`, response.status, 'at', new Date().toISOString());

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[${jobId}] API error:`, errorText);
        await store.setJSON(jobId, { status: "error", error: `API error: ${errorText}` });
        return;
      }

      const data = await response.json();
      console.log(`[${jobId}] stop_reason:`, data.stop_reason);

      if (data.stop_reason === 'pause_turn') {
        // Long-running turn was paused by the API mid-way through search.
        // Continue by feeding the assistant's partial turn back in.
        messages = [...messages, { role: 'assistant', content: data.content }];
        continue;
      }

      finalData = data;
      break;
    }

    if (!finalData) {
      await store.setJSON(jobId, {
        status: "error",
        error: "The search kept getting paused and did not complete after several continuations."
      });
      return;
    }

    // Sanity check: make sure there's actually a text block before declaring success
    const hasText = finalData.content?.some(block => block.type === 'text' && block.text?.trim().length > 0);

    if (!hasText) {
      console.log(`[${jobId}] No text block in final response. stop_reason: ${finalData.stop_reason}`);
      await store.setJSON(jobId, {
        status: "error",
        error: `The AI finished (reason: ${finalData.stop_reason}) but didn't write a text answer — only tool activity. This usually means it ran out of token budget mid-search. Try narrowing your filters.`,
        rawContentTypes: finalData.content?.map(b => b.type)
      });
      return;
    }

    console.log(`[${jobId}] Success!`);
    const resultPayload = { status: "done", data: finalData };
    await store.setJSON(jobId, resultPayload);

    // Also write to the cache key for this filter combination, so future
    // searches with the same location+discipline can skip straight to a
    // cached result instead of triggering a fresh AI search.
    const cacheKey = buildCacheKey(filters);
    await store.setJSON(cacheKey, { timestamp: Date.now(), data: finalData });
    console.log(`[${jobId}] Cached under key: ${cacheKey}`);

  } catch (error) {
    console.log("Background function error:", error.message);
    if (jobId) {
      await store.setJSON(jobId, { status: "error", error: error.message });
    }
  }
};
