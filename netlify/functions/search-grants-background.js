// This file MUST be named with a "-background" suffix — that's what tells
// Netlify to run it as a Background Function (up to 15 minutes, no 10s cap).
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

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4000,
        tools: [{
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3
        }],
        messages: [{
          role: "user",
          content: `Search for current grant opportunities for Early Career Researchers in Business and Law. Find grants that are currently open (closing date has not passed, currently accepting applications in ${currentMonth} ${currentYear}).

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

Find 4-6 grants specifically for Business, Law, or related social sciences fields. Only include grants with future closing dates.`
        }]
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
    console.log(`[${jobId}] Success! Stop reason:`, data.stop_reason);

    await store.setJSON(jobId, { status: "done", data });

  } catch (error) {
    console.log("Background function error:", error.message);
    if (jobId) {
      await store.setJSON(jobId, { status: "error", error: error.message });
    }
  }
};
