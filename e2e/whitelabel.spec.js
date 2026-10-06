import { expect, test } from '@playwright/test';

const ROOT = 'http://localhost:8788';
const FAKES = 'http://localhost:8790';
const RUN = Date.now().toString(36);
// A 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

// Buys `name` through the main site and the fake checkout. Returns the
// subdomain's URL and the path of the downloaded key file.
async function buySubdomain(page, name) {
  const host = `${name}.localhost:8788`;
  await page.goto(`${ROOT}/branded`);
  await page.getByRole('textbox', { name: 'Choose your subdomain' }).fill(name);
  await expect(page.locator('#get-status')).toHaveText(`${host} is available`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(`http://${host}/claim`);

  // The key is made before paying, and has to be saved first.
  const pay = page.getByRole('button', { name: 'Pay $5.99' });
  await page.getByRole('button', { name: 'Create my key' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download key file' }).click();
  const keyFile = await (await download).path();
  await expect(pay).toBeDisabled();
  await page.getByText('I agree to the terms').click();
  await pay.click();

  await page.getByRole('button', { name: 'Pay now' }).click();
  await expect(
    page.getByRole('heading', { name: `${host} is yours` })
  ).toBeVisible();
  return { site: `http://${host}`, keyFile };
}

async function makeMultilink(page, links) {
  const inputs = page.locator('#links .url-input');
  for (const [i, link] of links.entries()) await inputs.nth(i).fill(link);
  await page.getByRole('button', { name: 'Copy multilink' }).click();
  await expect(page.locator('#result')).toBeVisible();
  return page.locator('#result-link').inputValue();
}

test('an owner buys a subdomain, brands it and shares signed multilinks', async ({
  browser,
}) => {
  const owner = await browser.newPage();
  const { site, keyFile } = await buySubdomain(owner, `acme-${RUN}`);

  await owner.getByRole('link', { name: 'Set up branding' }).click();
  await owner.getByLabel('Title').fill('Acme Co');
  await owner.locator('#brand-accent').fill('#0f766e');
  await owner.locator('#brand-logo').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await owner.getByText('Show "Make your own multilink"').click();
  await owner.getByRole('button', { name: 'Save changes' }).click();
  await expect(owner.locator('#brand-status')).toHaveText(/^Saved/);

  await owner.goto(`${site}/`);
  await expect(owner.locator('#owner-bar')).toBeVisible();
  const link = await makeMultilink(owner, [
    'https://example.com/one',
    'https://example.org/two',
  ]);
  expect(link).toMatch(new RegExp(`^${site}/#A=.+&sign=[\\w-]+$`));

  const visitor = await browser.newContext();
  const shared = await visitor.newPage();
  await shared.goto(link);
  await expect(shared.locator('#verified')).toHaveText(
    'Verified link from Acme Co'
  );
  await expect(shared.locator('#landing .brand-name')).toHaveText('Acme Co');
  await expect(shared.locator('#landing img.brand-mark')).toBeVisible();
  await expect(shared.locator('#dest .dest-url')).toHaveText([
    'https://example.com/one',
    'https://example.org/two',
  ]);
  await expect(shared.locator('#make-own')).toBeHidden();

  for (const forged of [
    link.replace('example.org', 'evil.example'),
    link.replace('&list=1', ''),
    `${site}/#A=${encodeURIComponent('https://evil.example/')}`,
  ]) {
    const page = await visitor.newPage();
    await page.goto(forged);
    await expect(
      page.getByRole('heading', { name: "This link can't be verified" })
    ).toBeVisible();
    await page.close();
  }

  const home = await visitor.newPage();
  await home.goto(`${site}/`);
  await expect(
    home.getByRole('heading', { name: 'Verified multilinks from Acme Co' })
  ).toBeVisible();
  await expect(home.locator('#home-make-own')).toBeHidden();

  // The saved key file signs in on another device.
  const laptop = await (await browser.newContext()).newPage();
  await laptop.goto(`${site}/settings`);
  await laptop.locator('#signin-file').setInputFiles(keyFile);
  await expect(laptop.locator('#account')).toBeVisible();
  await expect(laptop.getByLabel('Title')).toHaveValue('Acme Co');
  await expect(laptop.locator('.key-item')).toHaveCount(1);
});

test('a lost key is replaced from the recovery email', async ({
  browser,
  request,
}) => {
  const lost = await browser.newPage();
  const { site } = await buySubdomain(lost, `lost-${RUN}`);

  const page = await (await browser.newContext()).newPage();
  await page.goto(`${site}/settings`);
  await page.getByRole('button', { name: 'Email me a recovery link' }).click();
  await expect(page.locator('#recover-status')).toContainText('emailed');

  let link;
  await expect
    .poll(async () => {
      const emails = await (await request.get(`${FAKES}/emails`)).json();
      link = emails
        .map((email) => email.text.match(/\S+\/recover#t=\S+/)?.[0])
        .find((url) => url?.startsWith(site));
      return link;
    })
    .toBeTruthy();

  await page.goto(link);
  await page.getByRole('button', { name: 'Create my key' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download key file' }).click();
  await download;
  await page.getByLabel('Revoke').check();
  await page.getByRole('button', { name: 'Save and sign in' }).click();
  await expect(page).toHaveURL(`${site}/settings`);
  await expect(page.locator('#account')).toBeVisible();
  await expect(page.locator('.key-item')).toHaveCount(1);

  // The revoked key is signed out.
  await lost.goto(`${site}/settings`);
  await expect(
    lost.getByRole('heading', { name: 'Sign in with your key' })
  ).toBeVisible();
});

test('subdomains nobody owns can be claimed', async ({ page }) => {
  const host = `free-${RUN}.localhost:8788`;
  await page.goto(`http://${host}/`);
  await expect(
    page.getByRole('heading', { name: `${host} is available` })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay $5.99' })).toBeDisabled();
});

test('the main site still makes plain multilinks', async ({ page }) => {
  await page.goto(`${ROOT}/`);
  const link = await makeMultilink(page, ['https://example.com/']);
  expect(link).toBe(`${ROOT}/#A=https%3A%2F%2Fexample.com%2F&list=1`);
  await expect(page.locator('#get-link')).toBeVisible();

  await page.goto('about:blank');
  await page.goto(link);
  await expect(page.locator('#dest .dest-url')).toHaveText([
    'https://example.com/',
  ]);
  await expect(page.locator('#verified')).toBeHidden();
});
