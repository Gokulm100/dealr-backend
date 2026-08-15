import assert from 'node:assert/strict';
import {
  CONTENT_POLICY_WARNING,
  buildImageAnalysisPrompts,
  formatInrDisplay,
  isBlockedImageResult,
  normalizeImageExtractDraft,
  parseInrPrice,
  sanitizeIndianLocation,
} from './aiAnalyzer.js';

const { systemPrompt, userText } = buildImageAnalysisPrompts('Electronics[Mobiles]');

assert.match(systemPrompt, /Keralite|Kerala/);
assert.match(systemPrompt, /You will be blocked if you repeat this action/);
assert.match(systemPrompt, /Indian Rupees|INR|₹/);
assert.doesNotMatch(systemPrompt, /Never set price or location/);
assert.match(userText, /Kerala, India listing/);
assert.match(userText, /"price":null/);
assert.match(userText, /"location":null/);
assert.match(userText, /"blocked":false/);

assert.equal(parseInrPrice(18500), 18500);
assert.equal(parseInrPrice('₹45,000'), 45000);
assert.equal(parseInrPrice('4.85 lakh'), 485000);
assert.equal(parseInrPrice('2 crore'), 20000000);
assert.equal(parseInrPrice('$450'), null);
assert.equal(parseInrPrice('USD 300'), null);
assert.equal(formatInrDisplay(18500), '₹18,500');
assert.equal(formatInrDisplay(485000), '₹4.85 lakh');

assert.equal(sanitizeIndianLocation('Kazhakkoottam, Thiruvananthapuram'), 'Kazhakkoottam, Thiruvananthapuram');
assert.equal(sanitizeIndianLocation('Kerala'), 'Kerala');
assert.equal(sanitizeIndianLocation('New York'), null);
assert.equal(sanitizeIndianLocation('downtown Los Angeles'), null);

assert.equal(isBlockedImageResult({ blocked: true }), true);
assert.equal(isBlockedImageResult({ description: 'nalla condition scooter' }), false);
assert.equal(isBlockedImageResult({ notes: 'explicit content / nude photo' }), true);

const blockedDraft = normalizeImageExtractDraft({
  blocked: true,
  title: 'should be dropped',
  description: 'should be dropped',
  price: 1000,
  location: 'Kerala',
});
assert.equal(blockedDraft.blocked, true);
assert.equal(blockedDraft.warning, CONTENT_POLICY_WARNING);
assert.equal(blockedDraft.title, null);
assert.equal(blockedDraft.description, null);
assert.equal(blockedDraft.price, null);
assert.equal(blockedDraft.location, null);

const catalog = [{ name: 'Electronics', subCategories: ['Mobiles'] }];
const okDraft = normalizeImageExtractDraft({
  blocked: false,
  title: 'iPhone 13 128GB, midnight',
  category: 'Electronics',
  subCategory: 'Mobiles',
  description: 'iPhone 13, 128GB. Battery nalla undu. Box and charger undu. Asking ₹28,000. Pattom, TVM.',
  price: 28000,
  priceDisplay: '₹28,000',
  location: 'Pattom, Thiruvananthapuram',
  visibleAttributes: { Color: 'Midnight' },
  confidence: {
    title: 0.9,
    category: 0.9,
    subCategory: 0.85,
    description: 0.88,
    price: 0.8,
    location: 0.75,
  },
}, catalog);

assert.equal(okDraft.blocked, false);
assert.equal(okDraft.category, 'Electronics');
assert.equal(okDraft.subCategory, 'Mobiles');
assert.equal(okDraft.price, 28000);
assert.equal(okDraft.priceDisplay, '₹28,000');
assert.equal(okDraft.location, 'Pattom, Thiruvananthapuram');

const dollarDraft = normalizeImageExtractDraft({
  title: 'Phone',
  category: 'Electronics',
  subCategory: 'Mobiles',
  description: 'Good phone',
  price: '$250',
  location: 'California',
  confidence: {
    title: 0.9,
    category: 0.9,
    subCategory: 0.9,
    description: 0.9,
    price: 0.9,
    location: 0.9,
  },
}, catalog);
assert.equal(dollarDraft.price, null);
assert.equal(dollarDraft.priceDisplay, null);
assert.equal(dollarDraft.location, null);

console.log('aiAnalyzer tests passed');
