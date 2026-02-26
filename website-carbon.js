#!/usr/bin/env node

/**
 * website-carbon.js
 * 
 * A command-line tool for estimating the carbon emissions of a website.
 */

// TODO: 
// - Measure the real transfer size rather than the buffer length (uncompressed)
// - Extend to allow other measurement events: idle0, idle2, load, domcontentloaded
// - Consider region/gridIntensity options for more accurate CO2 estimates
// - Consider other ways the transfer size calculations can be improved
// - Run Puppeteer pages in parallel to speed things up, perhaps 3-5 pages at a time?

// Imports
import fs from "fs";
import { parseArgs } from 'node:util';
import { co2, hosting } from "@tgwf/co2";
import puppeteer from "puppeteer";
import Crawler from "simplecrawler";
import Sitemapper from "sitemapper";
import { URL } from "url";

// Configuration
const DEBUG = false;
const FORCE_CRAWLER = false;

// Set up arguments and default values
const argOptions = {
	'help': {
		type: 'boolean',
		short: 'h',
		description: "Show help"
	},
	'file': {
		type: 'string',
		short: 'f',
		description: 'Path to a text file that lists the URLs to assess (one per line)'
	},
	'output': {
		type: 'string',
		default: 'cli',
		short: 'o',
		description: "Output format: 'cli' (text-based table, default) or 'csv' (for spreadsheets, etc.)"
	},
	'max-pages': {
		type: 'string',
		default: '100',
		short: 'p',
		description: "Maximum number of pages to assess"
	},
	'measure-event': {
		type: 'string',
		default: 'cdp',
		short: 'e',
		description: "Measurement event: 'cdp' (Chrome DevTools Protocol, default) or 'idle'"
	},
	'model': {
		type: 'string',
		default: 'swd', // swd (latest, default), swd3, swd4, 1byte
		short: 'm',
		description: "Carbon model: 'swd' (latest version of Sustainable Web Design Model, default), 'swd3', 'swd4', or '1byte'"
	},
	'no-ratings': {
		type: 'boolean',
		description: "Disable carbon ratings - enabled by default when supported (e.g. Sustainable Web Design Model)"
	}
};

// Process args
let values, positionals;
try {
    const args = parseArgs({
        options: argOptions,
        args: process.argv.slice(2),
        strict: true,
        allowPositionals: true
    });
	values = args.values;
	positionals = args.positionals;
} catch (e) {
    console.error(`❌ Argument error: ${e.message}`);
	console.log("Run with --help for usage information.");
    process.exit(1);
}

// Show help with --help argument or when input is missing (no URL or --file)
if (values.help || (positionals.length === 0 && !values.file)) {
    printHelp();
}

// Accept a site root as the last argument, or a list of URLs from a source file (--file <path>)
// The last argument is usually the website URL to assess, unless --file is used to specify a source file with URLs.
// When --file is provided, the website URL argument is ignored if present.
let siteUrl = null;
if (positionals.length > 0) {
	const lastArg = positionals[positionals.length - 1];

	// Check if the argument is a valid URL
	// If not, the script will use sourceFile instead
	try {
		new URL(lastArg);
		siteUrl = lastArg;
	} catch (e) {
		console.error("❌ Invalid URL: " + lastArg);
		process.exit(1);
	}
}

// Map arg values (see argOptions for options and defaults)
const sourceFile = values.file || null;
const outputFormat = values.output;
const maxPages = parseInt(values["max-pages"], 10);
const measureEvent = values["measure-event"];
const carbonModel = values.model;
const carbonRatings = values["no-ratings"] ? false : true;

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

// Using @tgwf/co2 library to estimate CO2 emissions
var co2Data = {};
var model;
var modelSupportsCarbonRating = false;

// Inform as to which model is being used
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

if (!modelSupportsCarbonRating && carbonRatings === true) {
	console.log("⚠️  Warning: Carbon ratings are only available with the Sustainable Web Design Model. Carbon ratings will not display.");
}

/**
 * Dynamically generates a help menu from the argConfig object.
 */
function printHelp() {
	console.log("\n🌱 Website carbon scorecard");
	console.log("Usage: node website-carbon.js [options] <url>");
	console.log("   Or: node website-carbon.js [options] --file <path/to/urls.txt>");
	console.log("\nOptions: ");

	// console.log("  --file <path>           Path to a text file containing list of URLs to assess (one per line)");
	// console.log("  --output <format>       Output format: 'cli' (default), 'csv'");
	// console.log("  --max-pages <N>         Maximum number of pages to assess (default: 50)");
	// console.log("  --measure-event <mode>  When to measure page size: 'cdp' (Chrome DevTools Protocol, default), 'idle'");
	// console.log("  --model <model>         Carbon model to use: 'swd' (latest, i.e. 'swd4', default), 'swd3', '1byte'");
	// console.log("  --ratings               Enable carbon ratings (where supported, default)");
	// console.log("  --no-ratings            Disable carbon ratings");

    for (const [name, config] of Object.entries(argOptions)) {
        const short = config.short ? `-${config.short}, ` : "    ";
        const label = `--${name}`.padEnd(16);
        const defaultValue = (config.default !== undefined) ? ` (default: ${config.default})` : "";
        console.log(`  ${short}${label} ${config.description}${defaultValue}`);
    }
    console.log("\nExample: ");
    console.log("  node website-carbon.js --max-pages 10 https://example.org/\n");
    process.exit(0);
}

/**
 * Converts bytes transferred to estimated CO2 emissions using the selected carbon model.
 * 
 * @param {number} bytes - The number of bytes transferred.
 * @param {boolean} [isGreen=false] - Whether the hosting is green (affects calculation). Default: false.
 * @returns {number} Estimated CO2 emissions in grams.
 */
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
 * Determines the Digital Carbon Rating based on estimated CO2 emissions.
 *
 * @param {number} co2e - The estimated CO2 emissions of a website in grams.
 * @returns {string} The Digital Carbon Rating, ranging from "A+" (best) to "F" (worst).
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

/**
 * Formats bytes as a human-readable string.
 *
 * @param {number} bytes - Number of bytes to format.
 * @param {object} [options] - Options object.
 * @param {number} [options.decimals=2] - Number of decimals to display. Default: 2.
 * @param {boolean} [options.outputUnit=true] - Whether to include the unit in the output. Default: true.
 * @param {string} [options.unit] - Force output in a specific unit (e.g., 'KB', 'MB').
 * @returns {string} Bytes as a formatted string.
 */
// Based on: https://stackoverflow.com/a/18650828
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
	} catch (e) {
		console.warn("⚠️  Could not fetch or parse site map:", e.message);
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
			.filter(line => line.length > 0)
			.filter(line => !line.startsWith('#'))
			.filter(line => !line.startsWith('//'));

		// Basic validation for URL format
		urls = urls.filter(url => {
			try {
				new URL(url);
				return true;
			} catch (e) {
				console.warn(`⚠️  Invalid URL skipped in file: ${url}`);
				return false;
			}
		});

		console.log(`📄 Using ${urls.length} URLs in '${filePath}'`);
		return urls;
	} catch (e) {
		console.error(`🚨 Error reading source file ${filePath}: ${e.message}`);
		process.exit(1);
	}
}

/** 
 * Crawls a website to discover URLs up to a maximum number of pages.
 * 
 * @param {string} siteUrl - The root URL of the site to crawl.
 * @returns {Promise<string[]>} A promise that resolves to an array of URLs.
 */
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
 * 
 * @param {object} browser - Puppeteer browser instance.
 * @param {string} url - The URL of the page to measure.
 * @param {object} [options] - Options object.
 * @param {boolean} [options.clearCache=false] - Whether to clear the browser cache before loading the page. Default: false.
 * @param {boolean} [options.isGreen=false] - Whether the hosting is green (affects calculation). Default: false.
 * @return {object|null} Measurement result with 'url', 'bytes', 'co2'. Failure: null.
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
			// FIXME - Measure the real transfer size rather than the buffer length (uncompressed)
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
	} catch (e) {
		console.error(`⚠️  measurePageIdle: Failed to load ${url}: ${e.message}`);
		await page.close();
		return null;
	}
}

/**
 * Measures the total transfer size (in bytes) and estimated CO2 for a single page load (with Chrome DevTools Protocol).
 * 
 * @param {object} browser - Puppeteer browser instance.
 * @param {string} url - The URL of the page to measure.
 * @param {object} [options] - Options object.
 * @param {boolean} [options.clearCache=false] - Whether to clear the browser cache before loading the page. Default: false.
 * @param {boolean} [options.isGreen=false] - Whether the hosting is green (affects calculation). Default: false.
 * @return {object|null} Measurement result with 'url', 'bytes', 'co2'. Failure: null.
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
		} catch (e) {
			console.error(`⚠️  measurePageCDP: Failed to load page: ${e.message}`);
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
	} catch (e) {
		console.error(`⚠️  measurePageCDP: Failed to load ${url}: ${e.message}`);
		return null;
	}
}

/**
 * Measures the total transfer size (in bytes) and estimated CO2 for a single page load.
 * 
 * @param {object} browser - Puppeteer browser instance.
 * @param {string} url - The URL of the page to measure.
 * @param {object} [options] - Options object.
 * @param {boolean} [options.clearCache=false] - Whether to clear the browser cache before loading the page. Default: false.
 * @param {string} [options.event='cdp'] - When to measure page size: 'cdp' (Chrome DevTools Protocol), 'idle'. Default: 'cdp'.
 * @param {boolean} [options.isGreen=false] - Whether the hosting is green (affects calculation). Default: false.
 * @return {object|null} Measurement result with 'url', 'bytes', 'co2'. Failure: null.
 */
async function measurePage(browser, url, options = {}) {
	const event = options.event || 'cdp';

	// TODO - Extend to allow other measurement events: idle0, idle2, load, domcontentloaded
	if (event === 'idle') {
		return await measurePageIdle(browser, url, options);
	}
	else { // Default to 'cdp' (Chrome DevTools Protocol)
		return await measurePageCDP(browser, url, options);
	}
}

/**
 * Main function for the website carbon assessment.
 */
async function main() {
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

	// Output summary as a text-based table
	console.log("\n=== 🌱 Website carbon summary ===");
	console.log(`Pages assessed: ${numResults}`);
	console.log(`Average size:   ${formatBytes(avgBytes)}`);
	console.log(`Average CO₂e:   ${(avgCO2e).toFixed(2)} g per page`);
	if (modelSupportsCarbonRating && carbonRatings) {
		console.log(`Overall Rating: ${carbonRating(avgCO2e)}`);
	}
	console.log(  "=================================");
}

main();
