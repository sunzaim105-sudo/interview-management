import { authJson } from './authFetch';

export async function scrapeJobLink(url) {
  return authJson('/api/jobs/scrape', {
    method: 'POST',
    body: { url },
  });
}
