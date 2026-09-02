import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('public Sprint offer presents the 30-Day Job Sprint without a price', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const sprintSection = html.match(/<section class="audit-section sprint-section" id="sprint">[\s\S]*?<\/section>/);

  assert.ok(sprintSection, 'Sprint offer section should remain present');
  assert.match(sprintSection[0], /<div class="section-eyebrow">Focused implementation<\/div>/);
  assert.match(sprintSection[0], /<h2>30-Day Job Sprint<\/h2>/);
  assert.match(sprintSection[0], /One job\. One live project\. Procedure, checks, and who may send\./);
  assert.doesNotMatch(sprintSection[0], /AUD \$5,000/);
  assert.doesNotMatch(sprintSection[0], /founding clients/i);
  assert.match(html, /<p class="assessment-price">AUD \$997 <span>\+ GST<\/span><\/p>/);
  assert.doesNotMatch(html, /id="sprint-commitment-title"/);
  assert.doesNotMatch(html, /30-Day Implementation Commitment/);
  assert.doesNotMatch(html, /not ready for use by Day 30 because of a Leveraged Systems defect/);
  assert.doesNotMatch(html, /\.audit-guarantee\b/);
});

test('Variation Shield software visual remains in its offer section', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const screenshot = await readFile(path.join(root, 'images', 'variation-shield-dashboard.png'));
  const productsSection = html.match(/<section class="products-section" id="products">[\s\S]*?<\/section>/);

  assert.ok(productsSection, 'Variation Shield offer section should remain present');
  assert.match(productsSection[0], /<div class="vs-dashboard-wrap reveal">/);
  assert.match(productsSection[0], /<img class="vs-product-screenshot"/);
  assert.match(productsSection[0], /src="images\/variation-shield-dashboard\.png"/);
  assert.match(productsSection[0], /width="1280" height="927"/);
  assert.match(productsSection[0], /alt="Variation Shield executive risk overview dashboard/);
  assert.doesNotMatch(productsSection[0], /West Gate Extension - Variations/);
  assert.equal(screenshot.readUInt32BE(16), 1280);
  assert.equal(screenshot.readUInt32BE(20), 927);
  assert.equal(
    createHash('sha256').update(screenshot).digest('hex'),
    'ceab7346fd7eb3a357d34ff65a544967a22c1cb23157560402dd6432dfbe9ee7',
  );
});

test('public site leads with the Assessment while preserving the offer hierarchy', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /<title>Commercial Control Assessment \| Leveraged Systems<\/title>/);
  assert.match(html, /<meta name="description" content="Find the one commercial job leaking money between site and the claim file\. \$997 \+ GST\. Four-day test plan\.">/);
  assert.match(html, /<meta property="og:title" content="Commercial Control Assessment \| Leveraged Systems">/);
  assert.match(html, /<meta property="og:description" content="Find the one commercial job leaking money between site and the claim file\. \$997 \+ GST\. Four-day test plan\.">/);
  assert.match(html, /<meta name="twitter:title" content="Commercial Control Assessment \| Leveraged Systems">/);
  assert.match(html, /<meta name="twitter:description" content="Find the one commercial job leaking money between site and the claim file\. \$997 \+ GST\. Four-day test plan\.">/);
  assert.match(html, /Clarity before commitment\./);
  assert.match(html, /Find the one job worth fixing/);
  assert.match(html, /hand you a four-day test/);
  assert.doesNotMatch(html, /AI &amp; Workflow/);
  assert.doesNotMatch(html, /AI and Workflow/);
  assert.match(html, /id="assessment"/);
  assert.match(html, /id="diagnostic"/);
  assert.ok(html.indexOf('id="assessment"') < html.indexOf('id="sprint"'));
  assert.ok(html.indexOf('id="sprint"') < html.indexOf('id="products"'));
});

test('Assessment keeps the approved process, inputs, and delivery terms', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const assessmentSection = html.match(/<section class="assessment-section" id="assessment">[\s\S]*?<\/section>/);

  assert.ok(assessmentSection, 'Assessment section should remain present');
  assert.match(assessmentSection[0], /<div class="process-section reveal">[\s\S]*?<h3>How it works<\/h3>/);
  assert.match(assessmentSection[0], /<strong>Prepare<\/strong><br>We confirm fit, scope and participants\. You bring one recurring problem and, where possible, one redacted example\./);
  assert.match(assessmentSection[0], /<strong>Owner Strategy Call<\/strong><br>A 30-minute call to understand the commercial pressure, consequences and priority\./);
  assert.match(assessmentSection[0], /<strong>Job Reality Session<\/strong><br>A separate 30-minute call with the person closest to the work to understand what happens, where it waits and what repeats\./);
  assert.match(assessmentSection[0], /<strong>Analyse and prepare<\/strong><br>We name one primary job, quantify the opportunity and prepare a custom nine-slide report with a four-day first test\./);
  assert.match(assessmentSection[0], /<strong>Walkthrough and decision<\/strong><br>One 30-minute walkthrough to confirm the findings, answer questions and record the next route\. Implementation is separate\./);
  assert.equal((assessmentSection[0].match(/<span class="step-num">[1-5]<\/span>/g) || []).length, 5);
  assert.match(assessmentSection[0], /<h3>What we need from you<\/h3>[\s\S]*?<li>30 minutes with the owner or decision-maker<\/li>[\s\S]*?<li>30 minutes with the person closest to the job<\/li>[\s\S]*?<li>One redacted example, template, screenshot or record where possible<\/li>[\s\S]*?<li>No perfect preparation pack required<\/li>/);
  assert.match(assessmentSection[0], /Target turnaround: five to seven business days from the approved analytical source bundle to a debrief-ready pack\. Review scheduling is separate\. The Assessment fee is credited toward a 30-Day Sprint accepted within 14 days\. AI is used only where it tightens the record\. Sign-off stays human\./);
  assert.doesNotMatch(assessmentSection[0], /Turnaround: 3 business days/);
});

test('public enquiry form captures offer interest and keeps the problem note optional', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /<select id="cf-offer" required>/);
  assert.match(html, /<option value="assessment" selected>Commercial Control Assessment<\/option>/);
  assert.match(html, /<option value="sprint">30-Day Job Sprint<\/option>/);
  assert.match(html, /<option value="variation-shield">Variation Shield<\/option>/);
  assert.match(html, /<textarea id="cf-improve"[^>]*><\/textarea>/);
  assert.doesNotMatch(html, /<textarea id="cf-improve"[^>]*required/);
  assert.match(html, /data-offer="assessment"/);
  assert.match(html, /data-offer="sprint"/);
  assert.match(html, /data-offer="variation-shield"/);
});
