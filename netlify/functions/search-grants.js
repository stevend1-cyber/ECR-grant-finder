exports.handler = async (event, context) => {
  console.log('Function called:', event.httpMethod);

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' })
      };
    }

    const { filters } = JSON.parse(event.body);
    console.log('Filters:', filters);

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().toLocaleString('default', { month: 'long' });

    let locationText = 'Both Australia and International';
    if (filters.location === 'australia') locationText = 'Australia';
    else if (filters.location === 'international') locationText = 'International (outside Australia)';

    console.log('Calling Anthropic API (single search, capped tokens)...');

    // Race the API call against a manual timeout so we fail fast with a clear
    // error instead of waiting for Netlify to kill the connection abruptly.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);

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
          model: "claude-sonnet-5",
          max_tokens: 1500,
          tools: [{
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 1 // CRITICAL: caps latency by allowing only one search round-trip
          }],
          messages: [{
            role: "user",
            content: `Do exactly ONE web search to find 3 current grant opportunities for Early Career Researchers in Business/Law, open in ${currentMonth} ${currentYear}. Location: ${locationText}.

After the search, immediately output ONLY a JSON array — no markdown fences, no preamble, no closing remarks. Be extremely concise in every field.

[{
  "name": "Grant Name",
  "organization": "Organization",
  "amount": "$XX,XXX",
  "closingDate": "Month Day, Year",
  "eligibility": "Brief requirements",
  "successRate": "XX% or Not available",
  "url": "https://...",
  "location": "Australia or International",
  "description": "One short sentence"
}]

Exactly 3 grants, all with future closing dates.`
          }]
        })
      });
    } finally {
      clearTimeout(timeoutId);
    }

    console.log('API response:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('API error:', errorText);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: `API error: ${errorText}` })
      };
    }

    const data = await response.json();
    console.log('Success! Stop reason:', data.stop_reason);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data)
    };

  } catch (error) {
    console.log('Error:', error.message);
    const isTimeout = error.name === 'AbortError';
    return {
      statusCode: isTimeout ? 504 : 500,
      headers,
      body: JSON.stringify({
        error: isTimeout
          ? 'The AI search took too long and was stopped before the platform timeout could cut it off ungracefully. Try again, or consider narrowing filters further.'
          : error.message
      })
    };
  }
};
