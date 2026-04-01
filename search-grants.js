// netlify/functions/search-grants.js
exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { filters } = JSON.parse(event.body);
    
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().toLocaleString('default', { month: 'long' });
    
    let searchQuery = `Early Career Researcher grants Business Law ${currentYear} ${currentMonth} open applications`;
    
    if (filters.location === 'australia') {
      searchQuery += ' Australia';
    } else if (filters.location === 'international') {
      searchQuery += ' international worldwide';
    }
    
    if (filters.minAmount || filters.maxAmount) {
      searchQuery += ' funding amount';
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search"
          }
        ],
        messages: [
          {
            role: "user",
            content: `Search for current grant opportunities for Early Career Researchers in Business and Law. Find grants that are currently open (closing date has not passed, currently accepting applications in ${currentMonth} ${currentYear}).

Location focus: ${filters.location === 'australia' ? 'Australia' : filters.location === 'international' ? 'International (outside Australia)' : 'Both Australia and International'}

Search Query: ${searchQuery}

For each grant found, extract:
1. Grant name/title
2. Funding body/organization
3. Amount/funding range
4. Closing date (must be in the future)
5. Eligibility criteria (especially for Early Career Researchers)
6. Success rate if available
7. URL/link to apply
8. Geographic focus (Australia or international)

Return ONLY a JSON array with this structure (no markdown, no preamble):
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

Focus on grants specifically for Business, Law, or related social sciences fields. Only include grants with future closing dates.`
          }
        ]
      })
    });

    const data = await response.json();
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify(data)
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
