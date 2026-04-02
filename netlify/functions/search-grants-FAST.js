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
    
    // Simplified, faster search query
    let searchQuery = `ECR grants Business Law ${currentYear} open`;
    
    if (filters.location === 'australia') {
      searchQuery += ' Australia';
    } else if (filters.location === 'international') {
      searchQuery += ' international';
    }

    console.log('Calling API with query:', searchQuery);

    // OPTIMIZED: Reduced max_tokens for faster response
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000, // REDUCED from 4000 for speed
        tools: [{
          type: "web_search_20250305",
          name: "web_search"
        }],
        messages: [{
          role: "user",
          content: `Find 3-5 current grant opportunities for Early Career Researchers in Business/Law. Open in ${currentMonth} ${currentYear}.

Location: ${filters.location === 'australia' ? 'Australia' : filters.location === 'international' ? 'International' : 'Both'}

Return ONLY this JSON (no markdown):
[{
  "name": "Grant Name",
  "organization": "Organization",
  "amount": "$XX,XXX",
  "closingDate": "Month Day, Year",
  "eligibility": "Brief requirements",
  "successRate": "XX% or Not available",
  "url": "https://...",
  "location": "Australia or International",
  "description": "One sentence description"
}]

Only include grants with future closing dates. Keep it concise.`
        }]
      })
    });

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
    console.log('Success!');
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data)
    };

  } catch (error) {
    console.log('Error:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
