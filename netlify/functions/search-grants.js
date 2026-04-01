exports.handler = async (event, context) => {
  console.log('Function called:', event.httpMethod);

  // CRITICAL: CORS headers must be included in EVERY response
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    
    if (!apiKey) {
      console.log('ERROR: No API key found');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'ANTHROPIC_API_KEY not set. Add it in Netlify Site Settings → Environment variables, then redeploy.' 
        })
      };
    }

    console.log('API key found');

    // Parse request
    const { filters } = JSON.parse(event.body);
    console.log('Filters:', filters);
    
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

    console.log('Calling Anthropic API...');

    // Call Anthropic API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
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

    console.log('API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('API error:', errorText);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ 
          error: `Anthropic API error: ${errorText}` 
        })
      };
    }

    const data = await response.json();
    console.log('Success! Returning data');
    
    return {
      statusCode: 200,
      headers, // CRITICAL: Include CORS headers
      body: JSON.stringify(data)
    };

  } catch (error) {
    console.log('Function error:', error.message);
    return {
      statusCode: 500,
      headers, // CRITICAL: Include CORS headers even on error
      body: JSON.stringify({ 
        error: error.message
      })
    };
  }
};
