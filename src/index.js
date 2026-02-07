export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    // Handle OPTIONS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // Home route
    if (url.pathname === '/') {
      return new Response(
        JSON.stringify({
          success: true,
          message: "WhatsApp SaaS Backend Deployed Successfully!",
          service: "Cloudflare Workers",
          timestamp: new Date().toISOString(),
          endpoints: {
            health: "/health",
            api_docs: "/api-docs",
            whatsapp_api: "/api/whatsapp",
            campaign_api: "/api/campaigns"
          }
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
    }
    
    // Health check
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: "healthy",
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
          memory: process.memoryUsage()
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
    }
    
    // API routes
    if (url.pathname === '/api/whatsapp') {
      return new Response(
        JSON.stringify({
          endpoint: "WhatsApp API",
          status: "active",
          message: "WhatsApp messaging endpoints are available"
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
    }
    
    if (url.pathname === '/api/campaigns') {
      return new Response(
        JSON.stringify({
          endpoint: "Campaign API",
          status: "active",
          message: "Campaign management endpoints are available"
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
    }
    
    // Not found
    return new Response(
      JSON.stringify({
        error: "Route not found",
        path: url.pathname,
        timestamp: new Date().toISOString()
      }),
      {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  }
};