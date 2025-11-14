#!/usr/bin/env node
import { co2 } from "@tgwf/co2";
import puppeteer from "puppeteer";
import Sitemapper from "sitemapper";
import { URL } from "url";

const DEBUG = true;
const MAX_PAGES = 100;
const CARBON_MODEL = 'swd'; // swd or 1byte
const CARBON_RATINGS = true;

const SWDMv3Ratings = {
	fifthPercentile: 0.095,
	tenthPercentile: 0.186,
	twentiethPercentile: 0.341,
	thirtiethPercentile: 0.493,
	fortiethPercentile: 0.656,
	fiftiethPercentile: 0.846,
};

if (CARBON_MODEL !== 'swd' && CARBON_RATINGS === true) {
	console.log("⚠️  Warning: Carbon ratings are only available with the Sustainable Web Design Model. Carbob ratings will not display.");
}

// Using @tgwf/co2 library to estimate CO2 emissions
const model = (CARBON_MODEL === '1byte') ? new co2({ model: "1byte" }) : new co2({ model: "swd", version: 4, rating: CARBON_RATINGS });
var co2Data = {};

function bytesToCO2(bytes) {
	const data = model.perByte(bytes);
	co2Data = data;

	/* const co2Estimate = model.calculate({
		bytesTransferred: bytes,
		region: "global", // or specify a region like 'us', 'eu', etc.
		device: "desktop", // or 'mobile'
		connectionType: "broadband", // or 'mobile'
	});
	*/

	return ((CARBON_MODEL == 'swd') && CARBON_RATINGS) ? data.total : data; // in grams of CO2e
}

// https://sustainablewebdesign.org/digital-carbon-ratings/
// https://github.com/thegreenwebfoundation/co2.js/blob/7adac52a77c886d281286f2a8926c61e6faba4fb/src/sustainable-web-design-v4.js#L337
// https://github.com/thegreenwebfoundation/developer-docs/issues/64
function carbonRating(co2e = null) {
	if (co2e !== null) {
		// FIXME – It seems ratingScale() is not a public method in co2.js?
		const {
			fifthPercentile,
			tenthPercentile,
			twentiethPercentile,
			thirtiethPercentile,
			fortiethPercentile,
			fiftiethPercentile,
		} = SWDMv3Ratings;

		const lessThanEqualTo = (num, limit) => num <= limit;

		/**
		 * Determines the rating of a website's sustainability based on its CO2 emissions.
		 *
		 * @param {number} co2e - The CO2 emissions of the website in grams.
		 * @returns {string} The sustainability rating, ranging from "A+" (best) to "F" (worst).
		 */
		// ratingScale(co2e) {
			if (lessThanEqualTo(co2e, fifthPercentile)) {
				return "A+";
			} else if (lessThanEqualTo(co2e, tenthPercentile)) {
				return "A";
			} else if (lessThanEqualTo(co2e, twentiethPercentile)) {
				return "B";
			} else if (lessThanEqualTo(co2e, thirtiethPercentile)) {
				return "C";
			} else if (lessThanEqualTo(co2e, fortiethPercentile)) {
				return "D";
			} else if (lessThanEqualTo(co2e, fiftiethPercentile)) {
				return "E";
			} else {
				return "F";
			}
		// }
	}
	return (CARBON_MODEL == 'swd') ? co2Data.rating : null;
}

// Source - https://stackoverflow.com/a/18650828
// Posted by anon, modified by community. See post 'Timeline' for change history
// Retrieved 2025-11-14, License - CC BY-SA 4.0
// Also see: https://gist.github.com/lanqy/5193417
function formatBytes(bytes, decimals = 2) {
	if (!+bytes) return '0 Bytes';

	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

async function fetchSitemapUrls(siteUrl) {
	const sitemapUrl = new URL("/sitemap.xml", siteUrl).href;

	const sitemap = new Sitemapper({
		url: sitemapUrl,
		timeout: 15000, // 10 seconds
		concurrency: 5,
		retries: 2,
		debug: DEBUG,
		requestHeaders: {
			'User-Agent': 'Mozilla/5.0 (compatible; SitemapperBot/1.0)',
		},
		fields: {
			loc: true,
			lastmod: true,
			// sitemap: true,
		},
	});

	console.log(`🔍 Checking for site map: ${sitemapUrl}`);

	try {
		const { url, sites, errors } = await sitemap.fetch();
		const urls = sites.map(site => site.loc);
		console.log(`📄 Found ${urls.length} URLs in the site map`);

		return urls.slice(0, MAX_PAGES);
	} catch (err) {
		console.log("⚠️  Could not fetch or parse site map:", err);
		return [];
	}
}

async function measurePageCO2(browser, url) {
	const page = await browser.newPage();
	let totalBytes = 0;

	page.on("response", async (response) => {
		try {
			const buffer = await response.buffer();
			totalBytes += buffer.length;
		} catch {
			// skip failed responses
		}
	});

	try {
		await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
		const co2 = bytesToCO2(totalBytes);

		const urlPath = new URL(url).pathname;
		if ((CARBON_MODEL == 'swd') && CARBON_RATINGS) {
			console.log(`${urlPath} – ${formatBytes(totalBytes)} – ${(co2).toFixed(3)}g CO₂e – ${carbonRating(co2)} rating`);
		} else {
			console.log(`${urlPath} – ${formatBytes(totalBytes)} – ${(co2).toFixed(3)}g CO₂e`);
		}

		await page.close();
		return { url, bytes: totalBytes, co2 };
	} catch (err) {
		console.log(`⚠️ Failed to load ${url}: ${err.message}`);
		await page.close();
		return null;
	}
}

async function main() {
	const siteUrl = process.argv[2];
	if (!siteUrl) {
		console.log("Usage: node website-carbon.js https://example.org/");
		process.exit(1);
	}

	// 1. Try to get sitemap URLs
	let urls = await fetchSitemapUrls(siteUrl);

	// 2. If no sitemap, just use homepage
	if (urls.length === 0) urls = [siteUrl];

	const browser = await puppeteer.launch({ headless: "new" });
	const results = [];

	// 3. Loop through up to MAX_PAGES
		console.log(`\n🌍 Assessing ${siteUrl}...\n`);
	for (const url of urls.slice(0, MAX_PAGES)) {
		const result = await measurePageCO2(browser, url);
		if (result) results.push(result);
	}

	await browser.close();

	// 4. Compute averages
	const avgBytes =
		results.reduce((sum, r) => sum + r.bytes, 0) / results.length;
	const avgCO2e =
		results.reduce((sum, r) => sum + r.co2, 0) / results.length;

	console.log("\n=== 🌱 Website Carbon Summary ===");
	console.log(`Pages assessed: ${results.length}`);
	console.log(`Average size:   ${formatBytes(avgBytes)}`);
	console.log(`Average CO₂e:   ${(avgCO2e).toFixed(2)} g per page`);
	if ((CARBON_MODEL == 'swd') && CARBON_RATINGS) {
			console.log(`Overall Rating: ${carbonRating(avgCO2e)}`);
	}
	console.log("=================================");
}

main();
