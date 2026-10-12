import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSite, fillKnown, dueLookups, recordLookups, pageSites, plainName, normCo } from '../lib/sites.mjs';

test('cleanSite keeps only the company\'s own site', () => {
  assert.equal(cleanSite('https://www.hawkemedia.com/about', 'Hawke Media'), 'https://www.hawkemedia.com/');
  assert.equal(cleanSite('https://careers.snowflake.com/us/en', 'Snowflake'), 'https://snowflake.com/');
  assert.equal(cleanSite('https://oliver.agency', 'OLIVER'), 'https://oliver.agency/');
  assert.equal(cleanSite('https://www.deptagency.com/', 'DEPT®'), 'https://www.deptagency.com/');
  assert.equal(cleanSite('https://acmewidgets.com', 'Acme Widgets Inc. (via a recruiter)'), 'https://acmewidgets.com/');
  assert.equal(cleanSite('https://www.linkedin.com/company/stripe', 'Stripe'), null);
  assert.equal(cleanSite('https://job-boards.greenhouse.io/stripe', 'Stripe'), null);
  assert.equal(cleanSite('https://example.com', 'Stripe'), null);
  assert.equal(cleanSite('javascript:alert(1)', 'Stripe'), null);
  assert.equal(cleanSite('https://user:pw@stripe.com', 'Stripe'), null);
  assert.equal(plainName('Northwind (part of Contoso)'), 'Northwind');
});

test('sites: known first, lookups capped, masked names skipped, results checked', () => {
  const sites = {};
  const companies = [
    { name: 'Fabrikam', urls: ['https://fabrikam.com/careers/ops'] },
    { name: 'Stripe', urls: ['https://www.linkedin.com/jobs/view/1'] },
    { name: 'Undisclosed (via a recruiter)', urls: [] },
    { name: 'Acme', urls: [] },
    { name: 'Hawke Media', urls: [] },
  ];
  assert.equal(fillKnown(sites, companies, { tracked_companies: [{ name: 'Hawke Media', website: 'https://hawkemedia.com' }] }, '2026-10-12'), true);
  assert.equal(sites.fabrikam.url, 'https://fabrikam.com/');
  assert.equal(sites.hawkemedia.how, 'portals');
  assert.deepEqual(dueLookups(sites, companies, '2026-10-12', 1), [{ company: 'Stripe', search: 'Stripe' }]);
  const r = recordLookups(sites, [{ company: 'Stripe', url: 'https://stripe.com/' }, { company: 'Acme', url: 'https://wrong.example.com' }], '2026-10-12');
  assert.deepEqual(r, { kept: 1, rejected: 1 });
  assert.equal(sites.acme.url, null);
  assert.deepEqual(dueLookups(sites, companies, '2026-10-20', 5), []);
  assert.deepEqual(dueLookups(sites, companies, '2027-01-01', 5).map(x => x.company), ['Acme']);
  assert.deepEqual(pageSites(sites, companies), { fabrikam: 'https://fabrikam.com/', stripe: 'https://stripe.com/', hawkemedia: 'https://hawkemedia.com/' });
  assert.equal(normCo('Tailspin+Toys'), 'tailspintoys');
});
