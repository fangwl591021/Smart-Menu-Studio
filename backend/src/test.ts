export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('TEST OK', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  },
};