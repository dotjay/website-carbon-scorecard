#!/usr/bin/env node

/**
 * website-carbon.js
 * 
 * A CLI tool to estimate the carbon emissions of a website.
 */

// TODO: 
// - Add command-line options for configuration (model, max pages, debug, etc.)
// - Consider region / gridIntensity options for more accurate CO2 estimates
// - Consider how tranfer size calculations can be improved
// - Run Puppeteer pages in parallel for increased speed (3-5 pages at a time?)

import { co2, hosting } from "@tgwf/co2";
import puppeteer from "puppeteer";
import Crawler from "simplecrawler";
import Sitemapper from "sitemapper";
import { URL } from "url";

const DEBUG = false;
const MAX_PAGES = 100;
const CARBON_MODEL = 'swd'; // swd (latest), swd3, swd4, 1byte
const CARBON_RATINGS = true;
const FORCE_CRAWLER = false;

const SWDMv3Ratings = {
	fifthPercentile: 0.095,
	tenthPercentile: 0.186,
	twentiethPercentile: 0.341,
	thirtiethPercentile: 0.493,
	fortiethPercentile: 0.656,
	fiftiethPercentile: 0.846,
};

if (modelSupportsCarbonRating && CARBON_RATINGS === true) {
	console.log("⚠️  Warning: Carbon ratings are only available with the Sustainable Web Design Model. Carbon ratings will not display.");
}

// Using @tgwf/co2 library to estimate CO2 emissions
var model;
var modelSupportsCarbonRating = false;
switch (CARBON_MODEL) {
	case '1byte':
		console.log("ℹ️  Carbon model: 1byte");
		model = new co2({ model: "1byte" });
		break;
	case 'swd3':
		console.log("ℹ️  Carbon model: Sustainable Web Design Model v3");
		model = new co2({ model: "swd", version: 3, rating: CARBON_RATINGS });
		modelSupportsCarbonRating = true;
		break;
	case 'swd':
	case 'swd4':
	default:
		console.log("ℹ️  Carbon model: Sustainable Web Design Model v4 (latest)");
		model = new co2({ model: "swd", version: 4, rating: CARBON_RATINGS });
		modelSupportsCarbonRating = true;
		break;
}

var co2Data = {};

function bytesToCO2(bytes, green = false) {
	if (bytes === 0) {
		co2Data = {
			total: 0,
			rating: modelSupportsCarbonRating ? "A+" : null
		};
		return 0;
	}

	// If hosting is green, green hosting factor = 1 (handled in co2.js)
	// https://sustainablewebdesign.org/estimating-digital-emissions/#faq-question-1713777503222
	var data;
	if (CARBON_MODEL === 'swd3') {
		// SWD v3
		// perByte(
		// 	bytes,
		// 	carbonIntensity = false,
		// 	segmentResults = false,
		// 	ratingResults = false,
		// 	options = {}
		// )
		data = model.perByte(bytes);
	} else {
		// SWD v4
		// perByte(
		// 	bytes,
		// 	green = false,
		// 	segmented = false,
		// 	ratingResults = false,
		// 	options = {}
		// )
		data = model.perByte(bytes, green);
	}
	
	co2Data = {
		total: data.total,
		rating: modelSupportsCarbonRating ? data.rating : null
	};

	return (modelSupportsCarbonRating) ? data.total : data; // in grams of CO2e
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

	return (modelSupportsCarbonRating) ? co2Data.rating : null;
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
			lastmod: true
		},
	});

	console.log(`🔍 Checking for site map: ${sitemapUrl}`);

	try {
		const { sites } = await sitemap.fetch();
		const urls = sites.map(site => site.loc);
		console.log(`📄 Found ${urls.length} URLs in the site map`);

		return urls.slice(0, MAX_PAGES);
	} catch (err) {
		console.log("⚠️  Could not fetch or parse site map:", err);
		return [];
	}
}

// Fallback crawler
async function crawlSiteForUrls(siteUrl) {
	return new Promise((resolve) => {
		const crawler = new Crawler(siteUrl);
		const crawledUrls = [];

		crawler.maxDepth = 3;
		crawler.maxConcurrency = 3;
		crawler.maxResources = MAX_PAGES;
		crawler.downloadUnsupported = false;

		// Exclude certain file types, such as CSS, JS, images, videos, archives
		crawler.addFetchCondition(function(queueItem) {
			return !queueItem.path.match(/\.(css|js|xml|zip|jpe?g|png|mp4|gif)$/i);
		});

		crawler.on("fetchcomplete", (queueItem) => {
			crawledUrls.push(queueItem.url);
			if (crawledUrls.length >= MAX_PAGES) {
				crawler.stop();
			}
		});

		crawler.on("complete", () => {
			console.log(`🕸️  Found ${crawledUrls.length} URLs by crawling the site`);
			resolve(crawledUrls);
		});

		crawler.start();
	});
}

// https://developers.thegreenwebfoundation.org/co2js/tutorials/check-hosting/
async function greenHosting(siteUrl, verbose = false) {
	// Must send a host domain to the hosting.check() method
	const hostDomain = new URL(siteUrl).hostname;

	// Note: hosting.check() isn't a thing in ESM version; use hosting()
	// FIXME: Update when @tgwf/co2 library is fixed (https://github.com/thegreenwebfoundation/co2.js/issues/266)
	const response = await hosting(hostDomain, {
		verbose: verbose,
		userAgentIdentifier: 'sustainability-auditor-cli'
	});

	if (DEBUG) {
		console.log("\n-----------------------------------");
		console.log(`🌿 Green hosting lookup result:`);
		console.log(response);
		console.log("-----------------------------------\n");
	}
	
	return verbose ? response.green : response;
}

async function measurePage(browser, url, green = false) {
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
		const co2 = bytesToCO2(totalBytes, green);

		const urlPath = new URL(url).pathname;
		if (modelSupportsCarbonRating && CARBON_RATINGS) {
			console.log(`${urlPath} – ${formatBytes(totalBytes)} – ${(co2).toFixed(3)}g CO₂e – ${carbonRating()} rating`);
		} else {
			console.log(`${urlPath} – ${formatBytes(totalBytes)} – ${(co2).toFixed(3)}g CO₂e`);
		}

		await page.close();
		return { url, bytes: totalBytes, co2 };
	} catch (err) {
		console.error(`⚠️ Failed to load ${url}: ${err.message}`);
		await page.close();
		return null;
	}
}

/**
 * Measures the total transfer size (in bytes) and estimated CO2 for a single page load.
 * @param {object} browser - Puppeteer Browser instance.
 * @param {string} url - The URL to navigate to.
 * @param {boolean} green - Whether the hosting is considered 'green'.
 * @param {boolean} clearCache - If true, clears the browser cache before navigation.
 */
// Alternative version measuring with CDP (Chrome DevTools Protocol)
// https://www.ashjohns.dev/blog/measuring-page-weight
async function measurePageCDP(browser, url, green = false, clearCache = false) {
	let client = null;
	let page = null;
	let totalBytes = 0;
	let co2 = null;

	try {
		// Set up session
		page = (await browser.pages())[0] || await browser.newPage();
		await page.setViewport({ width: 1900, height: 1000 });

		// Enable network tracking to capture transfer sizes
		client = await page.createCDPSession();
		await client.send('Network.enable');

		// Handle cache clearing
		if (clearCache) {
			// CDP command to clear all browser caches (disk and memory)
			await client.send('Network.clearBrowserCache');
			if (DEBUG) console.log(`COLD LOAD measurement. Cache cleared for ${url}.`);
		} else {
			if (DEBUG) console.log(`WARM LOAD measurement.`);
		}

		// Listen for network loading finished events to accumulate transfer sizes
		const onLoadingFinished = (data) => {
			if (data.encodedDataLength >= 0) {
				totalBytes += data.encodedDataLength;
			}
		};
		client.on('Network.loadingFinished', onLoadingFinished);

		try {
			// Navigate to the page and wait for network activity to finish
			await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

			// Estimate CO2 based on total bytes transferred
			co2 = bytesToCO2(totalBytes, green);

			const urlPath = new URL(url).pathname;
			if (modelSupportsCarbonRating && CARBON_RATINGS) {
				console.log(`${urlPath} – ${formatBytes(totalBytes)} – ${co2.toFixed(3)}g CO₂e – ${carbonRating()} rating`);
			} else {
				console.log(`${urlPath} – ${formatBytes(totalBytes)} – ${co2.toFixed(3)}g CO₂e`);
			}
		} catch (err) {
			console.error(`Failed to load page: ${err.message}`);
		} finally {
			if (client) {
				// Remove event listener and close the CDP session
				client.off('Network.loadingFinished', onLoadingFinished);
				await client.detach();
			}
			if (page) {
				await page.close();
			}
		}

		return { url, bytes: totalBytes, co2 };
	} catch (err) {
		console.error(`⚠️ Failed to load ${url}: ${err.message}`);
		return null;
	}
}

async function main() {
	const siteUrl = process.argv[2];
	if (!siteUrl) {
		console.log("Usage: node website-carbon.js https://example.org/");
		process.exit(1);
	}

	let green = false;
	let urls = [];

	// Check if hosting is green
	// Use greenHosting(siteUrl, true) for verbose output
	green = greenHosting(siteUrl);
	if (green) {
		console.log("🌿 Hosting is green!");
	}

	// Try to get sitemap URLs
	if (FORCE_CRAWLER) {
		console.log("⚠️  FORCE_CRAWLER is enabled - skipping site map check.");
	} else {
		urls = await fetchSitemapUrls(siteUrl);
	}

	// If no site map found, try crawling instead
	if (urls.length === 0) {
		console.log("🕷️  Crawling site to discover pages...");
		urls = await crawlSiteForUrls(siteUrl);
	}

	// Loop through up to MAX_PAGES
	console.log(`\n🌍 Assessing ${siteUrl}...`);

	// Launch headless browser
	const browser = await puppeteer.launch({ headless: "new", args: ['--incognito'] });

	// Limit to MAX_PAGES
	urls = urls.slice(0, MAX_PAGES);

	// First visits (cold loads)
	console.log(`\n🔄 First visits...`);
	const firstVisitResults = [];
	for (const url of urls) {
		const firstVisit = await measurePageCDP(browser, url, green, true);
		if (firstVisit) {
			firstVisitResults.push(firstVisit);
		}
	}

	// Return visits (warm loads)
	console.log(`\n💾 Return visits...`);
	const returnVisitResults = [];
	for (const url of urls) {
		const returnVisit= await measurePageCDP(browser, url, green, false);
		if (returnVisit) {
			returnVisitResults.push(returnVisit);
		}
	}

	await browser.close();

	// Compute averages of first visits (cold loads)
	const numResults = firstVisitResults.length;
	const avgBytes = firstVisitResults.reduce((sum, r) => sum + r.bytes, 0) / numResults;
	const avgCO2e = firstVisitResults.reduce((sum, r) => sum + r.co2, 0) / numResults;

	console.log("\n=== 🌱 Website Carbon Summary ===");
	console.log(`Pages assessed: ${numResults}`);
	console.log(`Average size:   ${formatBytes(avgBytes)}`);
	console.log(`Average CO₂e:   ${(avgCO2e).toFixed(2)} g per page`);
	if (modelSupportsCarbonRating && CARBON_RATINGS) {
		console.log(`Overall Rating: ${carbonRating(avgCO2e)}`);
	}
	console.log("=================================");
}

main();
