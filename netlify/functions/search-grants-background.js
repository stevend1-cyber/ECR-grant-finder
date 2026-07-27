const { getStore } = require("@netlify/blobs");

exports.handler = async function (event, context) {
  const store = getStore({ name: "grant-jobs", consistency: "strong" });

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

    const initialPrompt = `Search for current grant opportunities for Early Career Researchers in Business and Law. Find grants that are currently open (closing date has not passed, currently accepting applications in ${currentMonth} ${currentYear}).

Location focus: ${locationText}

For each grant found, extract:
1. Grant name/title
2. Funding body/organization
3. Amount/funding range
4. Closing date (must be in the future)
5. Eligibility criteria (especially for Early Career Researchers)
6. Success rate if available
7. URL/link to apply
8. Geographic focus (Australia or international)

After searching, output ONLY a JSON array — no markdown fences, no preamble, no closing remarks:
[{
  "name": "Grant Name",
  "organization": "Funding Body",
  "amount": "Amount range or specific amount",
  "closingDate": "Date string",
  "eligibility": "Brief eligibility summary",
  "successRate": "Percentage or 'Not available'",
  "url": "Application URL",
  "location": "Australia or International or Specific country",
  "description": "Brief description"
}]

Find exactly 4 grants specifically for Business, Law, or related social sciences fields. Only include grants with future closing dates. Do this efficiently — use at most 2 searches total, then write your final JSON answer.`;

    let messages = [{ role: "user", content: initialPrompt }];
    let finalData = null;
    const MAX_CONTINUATIONS = 2;

    for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
      console.log(`[${jobId}] API call attempt ${attempt + 1}`);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 8000, // generous budget so the final JSON never gets starved out
          tools: [{
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 2
          }],
          messages
        })
      });

      console.log(`[${jobId}] API response status:`, response.status);

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
    await store.setJSON(jobId, { status: "done", data: finalData });

  } catch (error) {
    console.log("Background function error:", error.message);
    if (jobId) {
      await store.setJSON(jobId, { status: "error", error: error.message });
    }
  }
};
