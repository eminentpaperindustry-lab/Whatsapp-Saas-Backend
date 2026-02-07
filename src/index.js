export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      
      // CORS headers
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };
      
      // Handle OPTIONS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { 
          headers: corsHeaders,
          status: 204 
        });
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
              whatsapp_api: "/api/whatsapp",
              campaign_api: "/api/campaigns"
            },
            note: "API endpoints are placeholders. Connect your backend logic."
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
            timestamp: new Date().toISOString(),
            service: "whatsapp-saas-backend",
            version: "1.0.0"
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
      
      // API routes - Placeholder responses
      if (url.pathname === '/api/whatsapp') {
        if (request.method === 'GET') {
          return new Response(
            JSON.stringify({
              endpoint: "WhatsApp API",
              status: "active",
              message: "WhatsApp messaging service is ready",
              methods: ["POST"],
              note: "Send POST request with message data"
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
        
        if (request.method === 'POST') {
          try {
            const body = await request.json();
            return new Response(
              JSON.stringify({
                success: true,
                message: "WhatsApp message queued",
                data: body,
                timestamp: new Date().toISOString(),
                note: "This is a placeholder. Connect your WhatsApp Business API."
              }),
              {
                status: 200,
                headers: {
                  ...corsHeaders,
                  'Content-Type': 'application/json'
                }
              }
            );
          } catch (error) {
            return new Response(
              JSON.stringify({
                error: "Invalid JSON in request body",
                message: error.message
              }),
              {
                status: 400,
                headers: corsHeaders
              }
            );
          }
        }
      }
      
      if (url.pathname === '/api/campaigns') {
        return new Response(
          JSON.stringify({
            endpoint: "Campaign API",
            status: "active",
            features: [
              "Create campaigns",
              "Schedule messages",
              "Track delivery",
              "Manage templates"
            ],
            note: "Connect your database and campaign logic here"
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
      
      // Dynamic API response for any /api/* route
      if (url.pathname.startsWith('/api/')) {
        return new Response(
          JSON.stringify({
            endpoint: url.pathname,
            method: request.method,
            status: "placeholder",
            message: "API endpoint detected. Add your business logic.",
            timestamp: new Date().toISOString()
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
          method: request.method,
          timestamp: new Date().toISOString(),
          available_routes: ["/", "/health", "/api/whatsapp", "/api/campaigns", "/api/*"]
        }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
      
    } catch (error) {
      // Global error handler
      return new Response(
        JSON.stringify({
          error: "Internal server error",
          message: error.message,
          timestamp: new Date().toISOString()
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }
  }
};