export default {
  async fetch(request) {
    return new Response(
      JSON.stringify({
        success: true,
        message: "WhatsApp SaaS Backend Deployed!",
        timestamp: new Date().toISOString()
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
};