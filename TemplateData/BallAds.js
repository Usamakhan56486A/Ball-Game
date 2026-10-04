// Google ad layer for Ball Game (WebGL only).
//
// This lives in the page template rather than a .jslib on purpose. Unity's jslib
// importer emits only the function members of the LibraryManager.library
// dictionary, so a large object literal placed in a .jslib is silently mangled or
// dropped at build time (an earlier version lost Ads_ShowRectangle that way and
// shipped a BallAds object that was never defined at all). Loaded here as a normal
// script it is copied verbatim into TemplateData/ and cannot be mangled.
//
// Unity's side is Assets/Plugins/WebGL/BallAds.jslib, which is now nothing but the
// five entry points that forward into this object.
var BallAds = window.BallAds = {
  publisher: "",
  bannerSlot: "",
  rewardTag: "",

  senseLoaded: false,
  imaLoaded: false,

  rewardPlaying: false,
  rewardDone: false,
  rewardTimer: null,
  imasdk: null,      // { player, manager }
  display: null,     // the ad manager used for the video

  // --------------------------------------------------------------- utilities
  send: function (method) {
    try {
      if (typeof SendMessage === "function") SendMessage("AdsBridge", method, "");
    } catch (e) {
      // The Unity instance is not up yet, or the page is tearing down.
    }
  },

  host: function (id) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      document.body.appendChild(el);
    }
    return el;
  },

  // ------------------------------------------------------------ AdSense units
  loadSense: function () {
    if (BallAds.senseLoaded) return true;
    if (!BallAds.publisher) return false;
    if (BallAds.senseTried) return false;      // do not retry a blocked script
    BallAds.senseTried = true;

    try {
      var s = document.createElement("script");
      s.async = true;
      s.crossOrigin = "anonymous";
      s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
      s.onload = function () { BallAds.senseLoaded = true; };
      s.onerror = function () { BallAds.senseLoaded = false; };
      document.head.appendChild(s);
      return true;
    } catch (e) {
      return false;
    }
  },

  // Builds one <ins> unit inside a host element. showOn means the unit is only
  // requested once the player has actually reached a screen where it belongs.
  makeUnit: function (hostId, slot, format, style) {
    var host = BallAds.host(hostId);
    if (host.getAttribute("data-slot") === slot) return;

    host.innerHTML = "";
    host.setAttribute("data-slot", slot);
    host.style.display = "none";               // stays hidden until it fills

    var ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "block";
    ins.style.width = style.width;
    ins.style.height = style.height;
    ins.setAttribute("data-ad-client", BallAds.publisher);
    ins.setAttribute("data-ad-slot", slot);
    ins.setAttribute("data-ad-format", format);
    ins.setAttribute("data-full-width-responsive", "true");
    host.appendChild(ins);

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
      // Pushing while the script is still loading is fine; it is queued.
    }
  },

  // -------------------------------------------------------------- IMA / video
  loadIma: function (done) {
    if (BallAds.imaLoaded) { done(); return; }
    if (window.google && window.google.ima) { BallAds.imaLoaded = true; done(); return; }

    if (BallAds.imaTried) { done(); return; }  // blocked or failed already
    BallAds.imaTried = true;

    try {
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";
      s.onload = function () { BallAds.imaLoaded = true; done(); };
      s.onerror = function () { BallAds.imaLoaded = false; done(); };
      document.head.appendChild(s);
    } catch (e) {
      done();
    }
  },

  // --------------------------------------------------------------- lifecycle
  configure: function (publisher, bannerSlot, rewardTag) {
    BallAds.publisher = publisher;
    BallAds.bannerSlot = bannerSlot;
    BallAds.rewardTag = rewardTag;
    if (BallAds.publisher) BallAds.loadSense();
  },

  showBanner: function () {
    if (!BallAds.bannerSlot) return;
    if (!BallAds.loadSense()) return;
    var host = BallAds.host("bg-ad-bottom");
    host.style.display = "block";
    BallAds.makeUnit("bg-ad-bottom", BallAds.bannerSlot, "horizontal",
                     { width: "100%", height: "90px" });
  },

  hideBanner: function () {
    ["bg-ad-bottom"].forEach(function (id) {
      var host = document.getElementById(id);
      if (host) host.style.display = "none";
    });
  },

  // ---------------------------------------------------------------- rewarded
  showRewarded: function (vastUrl, timeoutSeconds) {
    if (BallAds.rewardPlaying) return;
    if (!vastUrl) { BallAds.send("OnRewardedError"); return; }

    BallAds.rewardPlaying = true;
    BallAds.rewardDone = false;

    // Whatever happens, the player gets an answer. A VAST tag that stalls would
    // otherwise strand the button on "loading".
    if (BallAds.rewardTimer) clearTimeout(BallAds.rewardTimer);
    BallAds.rewardTimer = setTimeout(function () {
      if (BallAds.rewardPlaying && !BallAds.rewardDone) BallAds.finishRewarded(false);
    }, Math.max(5, timeoutSeconds || 90) * 1000);

    BallAds.loadIma(function () {
      if (!window.google || !window.google.ima) { BallAds.finishRewarded(false); return; }
      try {
        BallAds.startVideo(vastUrl);
      } catch (e) {
        BallAds.finishRewarded(false);
      }
    });
  },

  startVideo: function (vastUrl) {
    var ima = window.google.ima;

    // Remove any previous video layer so a second click cannot stack two.
    var old = document.getElementById("bg-ad-video");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var container = document.createElement("div");
    container.id = "bg-ad-video";
    document.body.appendChild(container);

    var player = new ima.AdPlayer(container);

    var display = new ima.AdDisplayContainer(container, true);
    ima.init({ adDisplayContainer: display });
    if (ima.ResizeHint) ima.ResizeHint(ima.AdDisplayContainer.SizeHint.FLUID);

    var manager = new ima.AdsManager(player);
    BallAds.imasdk = { player: player, manager: manager, display: display };
    BallAds.display = display;

    var settle = function (ok) {
      if (BallAds.rewardDone) return;
      BallAds.finishRewarded(ok);
    };

    manager.addEventListener(ima.AdEvent.Type.CONTENT_COMPLETE, function () { settle(true); });
    manager.addEventListener(ima.AdEvent.Type.SKIPPED, function () { settle(false); });
    manager.addEventListener(ima.AdEvent.Type.ALL_ADS_COMPLETED, function () { settle(true); });
    manager.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, function () { settle(false); });

    // init() must happen after the container has a real size, so defer a frame.
    requestAnimationFrame(function () {
      try {
        manager.init(Math.max(320, window.innerWidth),
                     Math.max(240, window.innerHeight),
                     ima.ViewMode.NORMAL);
        manager.start();
      } catch (e) {
        settle(false);
      }
    });

    var loader = new ima.AdsLoader(player);
    loader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
      function () { BallAds.requestAds(loader, vastUrl); });
    loader.loadAds(vastUrl);
  },

  // The AdsManager owns the containers, so ads must be requested through the
  // loader it handed back rather than the original one.
  requestAds: function (loader, vastUrl) {
    try {
      google.ima.AdsManager.init(loader.getAdsManager());
    } catch (e) {
      // Older SDK builds take the manager as a constructor argument instead.
    }

    var adSlots = [];
    try {
      adSlots = loader.getAdsManager().getAds();
    } catch (e) {
      // getAds() is unavailable on some SDK versions; requestAds still works.
    }

    var done = function (ok) {
      if (!BallAds.rewardDone) BallAds.finishRewarded(ok);
    };

    loader.requestAds(adSlots);
    try {
      var manager = BallAds.imasdk.manager;
      manager.addEventListener(google.ima.AdEvent.Type.CONTENT_COMPLETE, function () { done(true); });
      manager.addEventListener(google.ima.AdEvent.Type.SKIPPED, function () { done(false); });
      manager.addEventListener(google.ima.AdEvent.Type.ALL_ADS_COMPLETED, function () { done(true); });
      manager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, function () { done(false); });
    } catch (e) {
      done(false);
    }
  },

  finishRewarded: function (completed) {
    if (!BallAds.rewardPlaying) return;
    BallAds.rewardPlaying = false;
    BallAds.rewardDone = true;
    if (BallAds.rewardTimer) { clearTimeout(BallAds.rewardTimer); BallAds.rewardTimer = null; }

    try {
      if (BallAds.imasdk && BallAds.imasdk.manager) BallAds.imasdk.manager.destroy();
    } catch (e) { }
    BallAds.imasdk = null;
    BallAds.display = null;

    var old = document.getElementById("bg-ad-video");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    BallAds.send(completed ? "OnRewardedComplete" : "OnRewardedSkip");
  }
    };
