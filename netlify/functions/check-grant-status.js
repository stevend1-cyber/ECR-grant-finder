const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async function (event, context) {
  // REQUIRED in Lambda-compatibility mode (classic exports.handler functions) —
  // without this, getStore() throws on every single invocation.
  connectLambda(event);

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const jobId = event.queryStringParameters && event.queryStringParameters.jobId;

  if (!jobId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing jobId' }) };
  }

  try {
    const store = getStore({ name: "grant-jobs", consistency: "strong" });
    const result = await store.get(jobId, { type: "json" });

    if (!result) {
      // Not written yet — background job is still running (or just starting)
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'pending' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (error) {
    console.log('Status check error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
