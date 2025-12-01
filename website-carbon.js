#!/usr/bin/env node

/**
 * website-carbon.js
 * 
 * A CLI tool to estimate the carbon emissions of a website.
 */

// TODO: 
// - Consider how tranfer size calculations can be improved
// - Consider region / gridIntensity options for more accurate CO2 estimates
// - Run Puppeteer pages in parallel for increased speed (3-5 pages at a time?)

// Imports
import fs from "fs";
import { co2, hosting } from "@tgwf/co2";
import puppeteer from "puppeteer";
import Crawler from "simplecrawler";
import Sitemapper from "sitemapper";
import { URL } from "url";

// Configuration
const DEBUG = false;
const FORCE_CRAWLER = false;

// Defaults
let carbonModel = 'swd'; // swd (latest), swd3, swd4, 1byte
let carbonRatings = true; // Enable carbon ratings where supported
let maxPages = 100; // Maximum number of pages to assess
let measureEvent = 'cdp'; // 'cdp' (Chrome DevTools Protocol, default), 'idle'
let outputFormat = 'cli'; // 'cli' (default), 'csv' (for spreadsheets, etc.)
let siteUrl = null; // Site root URL to assess
let sourceFile = null; // Optional source file with list of URLs to assess

// Process args
const args = process.argv.slice(2);

// Accept a site root as the last argument, or a list of URLs from a source file (--file <path>)
const lastArg = args[args.length - 1];

// Check if last argument is a valid URL, and use that if so
try {
	new URL(lastArg);
	siteUrl = args.pop();
} catch (err) {}
// Process args
for (let i = 0; i < args.length; i++) {
	switch (args[i]) {
		case "--file":
			sourceFile = args[++i];
			break;
		case "--output":
			outputFormat = args[++i];
			break;
		case "--max-pages":
			maxPages = args[++i];
			break;
		case "--measure-event":
			measureEvent = args[++i];
			break;
		case "--model":
			carbonModel = args[++i];
			break;
		case "--ratings":
			carbonRatings = true;
			break;
		case "--no-ratings":
			carbonRatings = false;
			break;
		default:
			console.error("Unknown argument: " + args[i]);
	}
}

// Constants
const SWDM3_RATINGS = {
	fifthPercentile: 0.095,
	tenthPercentile: 0.186,
	twentiethPercentile: 0.341,
	thirtiethPercentile: 0.493,
	fortiethPercentile: 0.656,
	fiftiethPercentile: 0.846,
};
const SWDM4_RATINGS = {
	fifthPercentile: 0.04,
	tenthPercentile: 0.079,
	twentiethPercentile: 0.145,
	thirtiethPercentile: 0.209,
	fortiethPercentile: 0.278,
	fiftiethPercentile: 0.359,
};

if (modelSupportsCarbonRating && carbonRatings === true) {
	console.log("⚠️  Warning: Carbon ratings are only available with the Sustainable Web Design Model. Carbon ratings will not display.");
}

// Using @tgwf/co2 library to estimate CO2 emissions
var model;
var modelSupportsCarbonRating = false;
switch (carbonModel) {
	case '1byte':
		console.log("ℹ️  Carbon model: 1byte");
		model = new co2({ model: "1byte" });
		break;
	case 'swd3':
		console.log("ℹ️  Carbon model: Sustainable Web Design Model v3");
		model = new co2({ model: "swd", version: 3, rating: carbonRatings });
		modelSupportsCarbonRating = true;
		break;
	case 'swd':
	case 'swd4':
	default:
		console.log("ℹ️  Carbon model: Sustainable Web Design Model v4 (latest)");
		model = new co2({ model: "swd", version: 4, rating: carbonRatings });
		modelSupportsCarbonRating = true;
		break;
}

var co2Data = {};

function bytesToCO2(bytes, isGreen = false) {
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
	if (carbonModel === 'swd3') {
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
		data = model.perByte(bytes, isGreen);
	}
	
	co2Data = {
		total: data.total,
		rating: modelSupportsCarbonRating ? data.rating : null
	};

	return (modelSupportsCarbonRating && carbonRatings) ? data.total : data; // in grams of CO2e
}

/**
 * Determines the rating of a website's sustainability based on its CO2 emissions.
 *
 * @param {number} co2e - The CO2 emissions of the website in grams.
 * @returns {string} The sustainability rating, ranging from "A+" (best) to "F" (worst).
 */
// https://sustainablewebdesign.org/digital-carbon-ratings/
// https://github.com/thegreenwebfoundation/co2.js/blob/7adac52a77c886d281286f2a8926c61e6faba4fb/src/sustainable-web-design-v4.js#L337
// https://github.com/thegreenwebfoundation/developer-docs/issues/64
// Note: We emulate the ratingScale() function here to allow us to estimate an overall 
// carbon rating for a website based on average CO2e. The carbon rating of individual pages
// is returned by the co2.js library when using the SWD model with ratings enabled.
function carbonRating(co2e = null) {
	if (co2e !== null) {
		const {
			fifthPercentile,
			tenthPercentile,
			twentiethPercentile,
			thirtiethPercentile,
			fortiethPercentile,
			fiftiethPercentile,
		} = (carbonModel === 'swd3') ? SWDM3_RATINGS : SWDM4_RATINGS;

		const lessThanEqualTo = (num, limit) => num <= limit;

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
	}

	return (modelSupportsCarbonRating) ? co2Data.rating : null;
}

// Based on - https://stackoverflow.com/a/18650828
// Posted by anon, modified by community. See post 'Timeline' for change history
// Retrieved 2025-11-14, License - CC BY-SA 4.0
function formatBytes(bytes, options = {}) {
	if (!+bytes) return '0 Bytes';

	const decimals = options.decimals || 2;
	let unit = options.unit || null;
	const outputUnit = (options.outputUnit === false) ? false : true;

	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

	let i = 0;

	if (unit !== null) {
		const unitIndex = sizes.indexOf(unit);

		if (unitIndex === -1) {
			 console.warn(`Unsupported unit: ${options.unit}. Using defaults.`);
			 unit = null;
		} else {
			i = unitIndex;
		}
	}

	if (unit === null) {
		i = Math.floor(Math.log(bytes) / Math.log(k));
	}

	let unitString = '';
	if (outputUnit === true) {
		unitString = ` ${sizes[i]}`;
	}

	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))}${unitString}`;
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

		return urls; // Return all URLs; we'll limit later
	} catch (err) {
		console.warn("⚠️  Could not fetch or parse site map:", err);
		return [];
	}
}

/**
 * Reads URLs from a specified file path.
 *
 * @param {string} filePath - The path to the file containing URLs.
 * @returns {string[]} An array of valid URLs.
 */
async function readUrlsFromFile(filePath) {
	try {
		const fileContents = fs.readFileSync(filePath, 'utf8');
		// Split by new line, filter out empty lines, and trim whitespace
		let urls = fileContents.split("\n")
			.map(line => line.trim())
			.filter(line => line.length > 0);

		// Basic validation for URL format
		urls = urls.filter(url => {
			try {
				new URL(url);
				return true;
			} catch (err) {
				console.warn(`⚠️  Invalid URL skipped in file: ${url}`);
				return false;
			}
		});

		console.log(`📄 Using ${urls.length} URLs in ${filePath}`);
		return urls;
	} catch (err) {
		console.error(`🚨 Error reading source file ${filePath}: ${err.message}`);
		process.exit(1);
	}
}

// Fallback crawler
async function crawlSiteForUrls(siteUrl) {
	return new Promise((resolve) => {
		const crawler = new Crawler(siteUrl);
		const crawledUrls = [];

		crawler.maxDepth = 3;
		crawler.maxConcurrency = 3;
		crawler.maxResources = maxPages;
		crawler.downloadUnsupported = false;

		// Exclude certain file types, such as CSS, JS, images, videos, archives
		crawler.addFetchCondition(function(queueItem) {
			return !queueItem.path.match(/\.(css|js|xml|zip|jpe?g|png|mp4|gif)$/i);
		});

		crawler.on("fetchcomplete", (queueItem) => {
			crawledUrls.push(queueItem.url);
			if (crawledUrls.length >= maxPages) {
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

/**
 * Measures the total transfer size (in bytes) and estimated CO2 for a single page load (once idle).
 * @param {object} browser - Puppeteer Browser instance.
 * @param {string} url - The URL to navigate to.
 * @param {object} options - 'clearCache', 'isGreen'.
 */
async function measurePageIdle(browser, url, options = {}) {
	const {
		clearCache = false,
		isGreen = false
	} = options;

	let page = await browser.newPage();; 
	let totalBytes = 0;

	// Handle cache clearing
	if (clearCache) {
		const client = await page.target().createCDPSession();
		await client.send('Network.clearBrowserCache');
		if (DEBUG) {
			console.log(`Cache cleared for ${url}.`);
		}
	} else if (DEBUG) {
		console.log(`Cache not cleared.`);
	}
	
	page.on("response", async (response) => {
		try {
			const buffer = await response.buffer();
			totalBytes += buffer.length;
		} catch {
			// Skip failed responses
		}
	});

	try {
		// https://pptr.dev/api/puppeteer.puppeteerlifecycleevent
		await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
		const co2 = bytesToCO2(totalBytes, isGreen);

		const urlPath = new URL(url).pathname;
		if (outputFormat === 'csv') {
			if (modelSupportsCarbonRating && carbonRatings) {
				console.log(`${urlPath}, ${formatBytes(totalByte, { unit: 'KB', 'outputUnit': false })}, ${(co2).toFixed(3)}, ${carbonRating()}`);
			} else {
				console.log(`${urlPath}, ${formatBytes(totalBytes, { unit: 'KB', 'outputUnit': false })}, ${(co2).toFixed(3)}`);
			}
		}
		else {
			if (modelSupportsCarbonRating && carbonRatings) {
				console.log(`${urlPath} – ${formatBytes(totalBytes)} – ${(co2).toFixed(3)}g CO₂e – ${carbonRating()} rating`);
			} else {
				console.log(`${urlPath} – ${formatBytes(totalBytes)} – ${(co2).toFixed(3)}g CO₂e`);
			}
		}

		await page.close();
		return { url, bytes: totalBytes, co2 };
	} catch (err) {
		console.error(`⚠️  measurePageIdle: Failed to load ${url}: ${err.message}`);
		await page.close();
		return null;
	}
}

/**
 * Measures the total transfer size (in bytes) and estimated CO2 for a single page load (with Chrome DevTools Protocol).
 * @param {object} browser - Puppeteer Browser instance.
 * @param {string} url - The URL to navigate to.
 * @param {object} options - 'clearCache', 'isGreen'.
 */
// https://www.ashjohns.dev/blog/measuring-page-weight
async function measurePageCDP(browser, url, options = {}) {
	const {
		clearCache = false,
		isGreen = false
	} = options;

	let client = null;
	let page = null;
	let totalBytes = 0;
	let co2 = null;

	try {
		// Set up session
		page = (await browser.pages())[0] || await browser.newPage();
		await page.setViewport({ width: 1900, height: 1000 });

		// Enable network tracking to capture transfer sizes
		client = await page.target().createCDPSession();
		await client.send('Network.enable');

		// Handle cache clearing
		if (clearCache) {
			// CDP command to clear all browser caches (disk and memory)
			await client.send('Network.clearBrowserCache');
			if (DEBUG) {
				console.log(`Cache cleared for ${url}.`);
			}
		} else if (DEBUG) {
			console.log(`Cache not cleared.`);
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
			co2 = bytesToCO2(totalBytes, isGreen);

			const urlPath = new URL(url).pathname;
			if (outputFormat === 'csv') {
				if (modelSupportsCarbonRating && carbonRatings) {
					console.log(`${urlPath}, ${formatBytes(totalBytes, { unit: 'KB', 'outputUnit': false })}, ${co2.toFixed(3)}, ${carbonRating()}`);
				} else {
					console.log(`${urlPath}, ${formatBytes(totalBytes, { unit: 'KB', 'outputUnit': false })}, ${co2.toFixed(3)}`);
				}
			} else {
				if (modelSupportsCarbonRating && carbonRatings) {
					console.log(`${urlPath} – ${formatBytes(totalBytes)} – ${co2.toFixed(3)}g CO₂e – ${carbonRating()} rating`);
				} else {
					console.log(`${urlPath} – ${formatBytes(totalBytes)} – ${co2.toFixed(3)}g CO₂e`);
				}
			}
		} catch (err) {
			console.error(`⚠️  measurePageCDP: Failed to load page: ${err.message}`);
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
		console.error(`⚠️  measurePageCDP: Failed to load ${url}: ${err.message}`);
		return null;
	}
}

/**
 * Measures the total transfer size (in bytes) and estimated CO2 for a single page load.
 * @param {object} browser - Puppeteer Browser instance.
 * @param {string} url - The URL to navigate to.
 * @param {object} options - 'clearCache', 'event', 'isGreen'.
 */
async function measurePage(browser, url, options = {}) {
	const event = options.event || 'cdp';

	if (event === 'idle') {
		return await measurePageIdle(browser, url, options);
	}
	else { // Default to 'cdp' (Chrome DevTools Protocol)
		return await measurePageCDP(browser, url, options);
	}
}

async function main() {
	if ((siteUrl === null) && (sourceFile === null)) {
		console.log("Usage: node website-carbon.js [--max-pages <N>] [...] https://example.org/");
		console.log("   Or: node website-carbon.js --file <path/to/urls.txt> [--max-pages <N>] [...]");
		console.log("\nOptions: ");
		console.log("  --file <path>           Path to a text file containing list of URLs to assess (one per line)");
		console.log("  --output <format>       Output format: 'cli' (default), 'csv'");
		console.log("  --max-pages <N>         Maximum number of pages to assess (default: 50)");
		console.log("  --measure-event <mode>  When to measure page size: 'cdp' (Chrome DevTools Protocol, default), 'idle'");
		console.log("  --model <model>         Carbon model to use: 'swd' (latest, i.e. 'swd4', default), 'swd3', '1byte'");
		console.log("  --ratings               Enable carbon ratings (where supported, default)");
		console.log("  --no-ratings            Disable carbon ratings");
		process.exit(1);
	}

	if (siteUrl !== null) {
		try {
			new URL(siteUrl);
		} catch (err) {
			console.error("Invalid URL: " + siteUrl);
			process.exit(1);    
		}
	}

	let isGreen = false;
	let urls = [];

	if ((siteUrl === null) && (sourceFile !== null)) {
		urls = await readUrlsFromFile(sourceFile);

		// Use the origin of the first URL as the siteUrl for green hosting check
		siteUrl = new URL(urls[0]).origin;
	} else {
		// Try to get sitemap URLs
		if (FORCE_CRAWLER) {
			console.log("ℹ️  FORCE_CRAWLER is enabled - skipping site map check.");
		} else {
			urls = await fetchSitemapUrls(siteUrl);
		}

		// If no site map found, try crawling instead
		if (urls.length === 0) {
			console.log("🕷️  Crawling site to discover pages...");
			urls = await crawlSiteForUrls(siteUrl);
		}
	}

	// Exit if no URLs were found
	if (urls.length === 0) {
		console.error("❌ No valid URLs found to assess. Exiting.");
		process.exit(1);
	}

	// Check if hosting is green
	// Use greenHosting(siteUrl, true) for verbose output
	isGreen = greenHosting(siteUrl);
	if (isGreen) {
		console.log(`🌿 Hosting for '${new URL(siteUrl).hostname}' is green!`);
	}

	// Start looping through URLs
	const maxPagesStr = (urls.length > maxPages) ? ` (limiting to ${maxPages} pages)` : '';
	console.log(`\n🌍 Assessing ${siteUrl}${maxPagesStr}...`);

	// Launch headless browser
	// const browser = await puppeteer.launch({ headless: "new", args: ['--incognito'] });
	const browser = await puppeteer.launch({ headless: "new" });

	// Limit to maxPages
	urls = urls.slice(0, maxPages);

	// First visits (cold loads)
	console.log(`\n🔄 First visits...`);
	const firstVisitResults = [];
	for (const url of urls) {
		const firstVisit = await measurePage(browser, url, { event: measureEvent, isGreen: isGreen, clearCache: true });
		if (firstVisit) {
			firstVisitResults.push(firstVisit);
		}
	}

	// Return visits (warm loads)
	console.log(`\n💾 Return visits...`);
	const returnVisitResults = [];
	for (const url of urls) {
		const returnVisit= await measurePage(browser, url, { event: measureEvent, isGreen: isGreen });
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
	if (modelSupportsCarbonRating && carbonRatings) {
		console.log(`Overall Rating: ${carbonRating(avgCO2e)}`);
	}
	console.log("=================================");
}

main();
