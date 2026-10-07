// Closed placeholder for connecting a branch-specific cloud build. It has no
// container, AI service, tenant storage, public route, or recognition endpoint.
export default { fetch: () => new Response(null, { status: 404 }) } satisfies ExportedHandler;
