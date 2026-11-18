const dashboardOrigins = new Set([
  'https://app.sakireemsolutions.com',
  'https://sensational-cucurucho-b41b69.netlify.app',
]);

export const isDashboardOrigin = origin => dashboardOrigins.has(origin);
