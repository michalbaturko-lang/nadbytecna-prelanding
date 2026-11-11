// Oficiální snippet Vercel Web Analytics pro statické HTML.
// https://vercel.com/docs/analytics/quickstart
export const webAnalyticsScript = "\n  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };\n";

export const webAnalyticsHtml = `<script>${webAnalyticsScript}</script>
<script defer src="/_vercel/insights/script.js"></script>`;
