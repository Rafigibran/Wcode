const TEST_INTERSTITIAL_AD_UNIT_ID =
	"ca-app-pub-3940256099942544/1033173712";

let currentAd = null;
let loadPromise = null;
let showing = false;
let pendingShows = 0;

function getAdMob() {
	return globalThis.admob;
}

function bindLifecycle(ad) {
	ad.on("dismiss", () => {
		if (currentAd === ad) currentAd = null;
		showing = false;
		void preloadInterstitial();
		if (pendingShows > 0) void drainQueue();
	});
	ad.on("showfail", () => {
		if (currentAd === ad) currentAd = null;
		showing = false;
		void preloadInterstitial();
		if (pendingShows > 0) void drainQueue();
	});
}

export async function preloadInterstitial() {
	const admob = getAdMob();
	if (!admob) return null;

	if (currentAd) {
		try {
			if (await currentAd.isLoaded()) return currentAd;
		} catch {
			currentAd = null;
		}
	}

	if (loadPromise) return loadPromise;

	loadPromise = (async () => {
		try {
			const ad = new admob.InterstitialAd({
				adUnitId: TEST_INTERSTITIAL_AD_UNIT_ID,
			});
			bindLifecycle(ad);
			await ad.load();
			currentAd = ad;
			return ad;
		} catch (error) {
			console.warn("Interstitial ad failed to load:", error);
			currentAd = null;
			return null;
		} finally {
			loadPromise = null;
		}
	})();

	return loadPromise;
}

async function drainQueue() {
	if (showing || pendingShows <= 0) return;

	const ad = await preloadInterstitial();
	if (!ad || showing) return;

	try {
		if (!(await ad.isLoaded())) {
			if (currentAd === ad) currentAd = null;
			void preloadInterstitial();
			return;
		}

		pendingShows -= 1;
		showing = true;
		await ad.show();
	} catch (error) {
		showing = false;
		if (currentAd === ad) currentAd = null;
		console.warn("Interstitial ad failed to show:", error);
		void preloadInterstitial();
		if (pendingShows > 0) void drainQueue();
	}
}

export default function showInterstitialAd() {
	pendingShows += 1;
	void drainQueue();
}

function initializeInterstitialAds() {
	if (!getAdMob()) return;
	void preloadInterstitial();
}

if (typeof document !== "undefined") {
	document.addEventListener("deviceready", initializeInterstitialAds, {
		once: true,
	});
	if (getAdMob()) initializeInterstitialAds();
}
