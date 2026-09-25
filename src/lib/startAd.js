import {
	AdConsentCoordinator,
	EMPTY_PRIVACY_STATE,
} from "./adConsentCoordinator.mjs";
import {
	BANNER_SUPPRESSION_REASON,
	bannerVisibilityController,
} from "./bannerVisibilityController.mjs";
import config from "./config";

export { BANNER_SUPPRESSION_REASON };

export let adUnitIdBanner = "ca-app-pub-5911839694379275/9157899592"; // Production
export let adUnitIdInterstitial = "ca-app-pub-3940256099942544/1033173712"; // Google test interstitial
export let adUnitIdRewarded = "ca-app-pub-5911839694379275/1633667633"; // Production
export let initialized = false;

/** @type {import("plugins/admob/src/www").BannerAd} */
export let bannerAd = null;
/** @type {import("plugins/admob/src/www").InterstitialAd} */
export let interstitialAd = null;
let consentCoordinator = null;
let interstitialLoadPromise = null;
let interstitialShowing = false;
let pendingInterstitialRequests = 0;

export default async function startAd() {
	if (!canUseAdmob()) {
		if (
			!config.HAS_PRO &&
			typeof admob !== "undefined" &&
			window.ANDROID_SDK_INT < 29
		) {
			console.warn("AdMob not supported on this Android version, skipping ads");
		}
		return;
	}

	try {
		await getConsentCoordinator().start();
	} catch (error) {
		console.error("Failed to initialize ads:", error);
	}
}

export function getPrivacyState() {
	return consentCoordinator?.state ?? { ...EMPTY_PRIVACY_STATE };
}

/**
 * Subscribes to normalized UMP state. The current state is emitted immediately.
 * @param {(state:typeof EMPTY_PRIVACY_STATE)=>void} listener
 * @returns {()=>void}
 */
export function subscribePrivacyState(listener) {
	if (typeof listener !== "function") {
		throw new TypeError("Privacy state listener must be a function.");
	}

	if (!canUseAdmob()) {
		listener(getPrivacyState());
		return () => {};
	}

	return getConsentCoordinator().subscribe(listener);
}

export async function showInterstitialAd() {
	pendingInterstitialRequests += 1;
	return drainInterstitialQueue();
}

async function drainInterstitialQueue() {
	if (interstitialShowing || pendingInterstitialRequests <= 0) return false;
	if (!canUseAdmob() || !interstitialAd) return false;

	try {
		if (!(await interstitialAd.isLoaded())) {
			await preloadInterstitial();
			if (!(await interstitialAd.isLoaded())) return false;
		}

		pendingInterstitialRequests -= 1;
		interstitialShowing = true;
		await interstitialAd.show();
		return true;
	} catch (error) {
		interstitialShowing = false;
		console.warn("Failed to show interstitial ad:", error);
		return false;
	}
}

async function preloadInterstitial() {
	if (!interstitialAd) return false;
	if (interstitialLoadPromise) return interstitialLoadPromise;

	interstitialLoadPromise = interstitialAd
		.load()
		.then(() => true)
		.catch((error) => {
			console.warn("Failed to preload interstitial ad:", error);
			return false;
		})
		.finally(() => {
			interstitialLoadPromise = null;
		});

	return interstitialLoadPromise;
}

export async function showPrivacyOptions() {
	if (!canUseAdmob()) {
		throw new Error("AdMob Privacy Choices are unavailable.");
	}
	return getConsentCoordinator().showPrivacyOptions();
}

function canUseAdmob() {
	return typeof admob !== "undefined" && window.ANDROID_SDK_INT >= 29;
}

function getConsentCoordinator() {
	consentCoordinator ??= new AdConsentCoordinator({
		privacy: admob.privacy,
		initializeAds,
		onError: (error) =>
			console.warn("Unable to refresh AdMob consent information:", error),
	});
	return consentCoordinator;
}

async function initializeAds() {
	if (initialized) return;

	if (BuildInfo.buildType === "debug") {
		console.info("!!! Using test ads");
		adUnitIdBanner = "ca-app-pub-3940256099942544/6300978111";
		adUnitIdInterstitial = "ca-app-pub-3940256099942544/1033173712";
		adUnitIdRewarded = "ca-app-pub-3940256099942544/5224354917";
	}

	await admob.start();

	const currentHour = new Date().getHours();
	const isQuietHours = currentHour >= 22 || currentHour < 4;

	await admob.configure({
		appMuted: isQuietHours,
		appVolume: isQuietHours ? 0.0 : 1.0,
	});

	const banner = new admob.BannerAd({
		adUnitId: adUnitIdBanner,
		position: "bottom",
	});
	const interstitial = new admob.InterstitialAd({
		adUnitId: adUnitIdInterstitial,
	});

	bannerAd = banner;
	interstitialAd = interstitial;
	interstitial.on("dismiss", () => {
		interstitialShowing = false;
		void preloadInterstitial();
		void drainInterstitialQueue();
	});
	interstitial.on("showfail", () => {
		interstitialShowing = false;
		void preloadInterstitial();
		void drainInterstitialQueue();
	});
	void preloadInterstitial();
	bannerVisibilityController.setBanner(banner);
	window.ad = banner;
	window.iad = interstitial;
	window.adRewardedUnitId = adUnitIdRewarded;
	initialized = true;
	void drainInterstitialQueue();
}

/**
 * Adds or removes one independent reason for hiding banner ads.
 * @param {string} reason
 * @param {boolean} suppressed
 */
export function setBannerSuppressed(reason, suppressed) {
	bannerVisibilityController.setSuppressed(reason, suppressed);
}

/**
 * Registers a page as eligible to display the shared banner.
 * @param {HTMLElement} page
 */
export function requestBannerForPage(page) {
	bannerVisibilityController.registerPage(page);
}

/**
 * Temporarily suppresses the banner while the soft keyboard is visible.
 * @param {boolean} visible
 */
export function setBannerKeyboardVisible(visible) {
	bannerVisibilityController.setKeyboardVisible(visible);
}
