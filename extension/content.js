function pickStream(items) {
  const streams = items.filter((m) => m.kind === "hls" || m.kind === "dash");
  const main = streams.find((m) => m.qualities?.length > 1) || streams.find((m) => m.qualities?.length);
  if (main || !streams.length) return main || null;
  return streams.filter((m) => streams[0].at - m.at < 60000).at(-1);
}


// BaaDash page helper.
// - Shows a "Download video" button over video players. Clicking it lists
//   the media files the page loaded and sends the chosen one to BaaDash.
// - Alt+click on a link tells the background to let the browser handle
//   that one download itself.
// Everything lives in a closed shadow root so page styles can't touch it.

(() => {
  if (window.__baadashLoaded) return;
  window.__baadashLoaded = true;

  // Alt+click: skip BaaDash for this download.
  document.addEventListener(
    "click",
    (e) => {
      if (e.altKey && e.target.closest?.("a[href]"))
        chrome.runtime.sendMessage({ type: "bypass" }).catch(() => {});
    },
    true,
  );

  // Magnet links aren't downloads, so the browser would hand them to another
  // app. Send them to BaaDash; if it can't take them, open the link as usual.
  document.addEventListener(
    "click",
    async (e) => {
      const a = e.target.closest?.('a[href^="magnet:"]');
      if (!a || e.altKey || e.button !== 0 || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      let res;
      try {
        res = await chrome.runtime.sendMessage({ type: "magnet", url: a.href });
      } catch {
        res = null;
      }
      if (!res?.ok) location.href = a.href;
    },
    true,
  );

  const MIN_W = 200,
    MIN_H = 112;
  // Video sites BaaDash downloads through yt-dlp: the page itself is sent,
  // and the quality is chosen in BaaDash.
  const VIDEO_SITE =
    /(^|\.)(youtube\.com|youtube-nocookie\.com|vimeo\.com|x\.com|twitter\.com|reddit\.com|instagram\.com|tiktok\.com|facebook\.com|twitch\.tv|dailymotion\.com|bilibili\.com)$/i;
  const onVideoSite = () => VIDEO_SITE.test(location.hostname);
  const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true" viewBox="0 0 1024 1024" fill="none"><rect x="32" y="32" width="960" height="960" rx="220" fill="#202126"/><g transform="translate(96 167.46012269938646) scale(1.0208588957055216)"><path d="M 527 68.475 C 499.530 73.125, 474.110 85.712, 451.006 106.102 L 441.839 114.193 433.169 113.702 C 428.401 113.432, 420.225 112.043, 415 110.614 C 386.768 102.895, 365.647 103.441, 338.072 112.600 C 308.943 122.275, 280.589 142.908, 257.389 171.310 C 254.370 175.005, 252.977 175.560, 210.389 190.041 C 181.058 200.014, 168.158 204.804, 171.500 204.481 C 187.360 202.953, 203.507 202, 213.554 202 L 225 202 225 209.191 C 225 213.147, 224.491 221.408, 223.868 227.550 L 222.736 238.717 214.118 239.990 C 159.848 248.006, 115.229 274.217, 98.062 308.168 C 89.684 324.736, 88.312 336.243, 92.950 351.042 C 94.350 355.507, 94.978 360.288, 94.987 366.536 L 95 375.573 84.032 380.984 C 77.999 383.961, 73.161 386.487, 73.282 386.599 C 73.402 386.710, 78.450 385.941, 84.500 384.891 C 90.999 383.763, 98.942 383.088, 103.913 383.241 L 112.326 383.500 115.663 393.462 C 118.297 401.324, 119 405.050, 119 411.140 L 119 418.856 113.750 420.814 C 110.863 421.890, 105 424.010, 100.723 425.525 C 96.445 427.039, 93.070 428.344, 93.223 428.425 C 93.375 428.505, 99.575 428.264, 107 427.890 C 114.425 427.515, 128.488 427.162, 138.250 427.104 L 156 427 156 434.750 L 155.999 442.500 148.750 450.074 C 121.252 478.804, 123.330 511.012, 154.213 534.767 C 171.616 548.152, 200.861 557.162, 221.818 555.594 C 226.593 555.237, 236.165 554.681, 243.089 554.359 L 255.677 553.774 258.260 558.137 C 273.681 584.184, 307.234 603.562, 342.017 606.508 C 352.345 607.383, 369.373 604.293, 384.051 598.880 C 400.830 592.692, 407.751 592.515, 424.192 597.851 C 446.324 605.035, 459.898 606.495, 476.049 603.431 C 504.259 598.080, 531.969 579.555, 550.364 553.750 L 555.176 547 562.441 547 C 567.244 547, 573.568 548, 581.103 549.950 C 605.834 556.353, 615.450 556.741, 632.612 552.033 C 667.591 542.437, 699.699 509.972, 712.853 470.902 L 715.681 462.500 709.314 445.713 C 698.832 418.079, 696.821 409.008, 696.245 386.745 L 695.759 367.989 712.130 368.048 C 747.088 368.173, 777.898 357.254, 794.411 338.887 C 799.990 332.682, 799.989 333.514, 794.423 326.109 C 783.578 311.683, 756.348 294.119, 731.250 285.362 L 726 283.531 726 274.904 C 726 266.917, 726.299 265.639, 730.032 257.672 C 740.151 236.080, 740.659 220.999, 731.979 199.949 C 719.779 170.365, 691.497 149.917, 660.499 148.270 L 650.498 147.738 645.371 137.119 C 623.103 90.994, 571.329 60.970, 527 68.475" fill="#FFFFFF" fill-rule="evenodd"/><path d="M 524.500 60.618 C 489.353 65.866, 461.315 78.215, 439.840 97.906 L 433.179 104.013 426.840 102.544 C 367.942 88.896, 306.713 104.754, 265.246 144.397 C 258.175 151.157, 247.073 163.709, 245.489 166.733 C 245.422 166.861, 238.197 168.310, 229.434 169.952 C 196.750 176.076, 155.415 190.306, 99.643 214.636 C 87.624 219.879, 88.851 219.907, 139 215.526 C 161.275 213.580, 195.475 210.631, 215 208.972 C 234.525 207.313, 262.784 204.841, 277.797 203.478 C 292.811 202.115, 305.861 200.986, 306.797 200.970 C 313.935 200.842, 287.723 194.728, 272.500 192.970 C 267 192.335, 262.356 191.675, 262.180 191.505 C 261.568 190.910, 265.857 183.453, 271.097 176 C 285.064 156.133, 308.734 138.781, 333.291 130.407 C 382.340 113.681, 449.556 124.334, 491.964 155.553 C 499.097 160.803, 499.333 160.372, 493.915 151.990 C 486.137 139.956, 474.052 128.302, 462.250 121.454 C 457.982 118.978, 457.873 119.246, 466.358 111.349 C 500.119 79.923, 559.037 75.933, 598.818 102.379 C 624.883 119.707, 640.579 153.097, 637.629 184.942 L 637.022 191.500 641.475 186.568 C 643.925 183.855, 647.857 177.700, 650.214 172.890 L 654.500 164.144 659.090 164.072 C 669.509 163.909, 683.830 169.219, 695.739 177.662 C 731.819 203.242, 729.249 264.307, 691.028 289.600 C 685.837 293.035, 685.718 292.837, 687.614 283.932 C 688.755 278.573, 689.045 273.572, 688.653 266 C 687.833 250.176, 687.144 249.129, 684.480 259.657 C 675.817 293.885, 653.376 315.092, 620 320.592 C 586.641 326.089, 546.662 310.597, 533.149 286.938 L 530.261 281.881 535.313 274.220 C 539.886 267.283, 554 241.191, 554 239.673 C 554 239.329, 548.487 244.720, 541.750 251.654 C 512.114 282.154, 483.042 296.762, 446.500 299.514 C 386.926 304.001, 344.655 259.402, 372.036 220.950 C 374.910 216.913, 373.125 217.250, 367.340 221.837 C 357.726 229.458, 350.728 239.593, 347.586 250.445 L 346.431 254.434 313.966 254.502 C 279.259 254.574, 274.873 255.016, 253.136 260.633 C 222.317 268.597, 183.567 289.062, 158 310.878 C 147.214 320.082, 133.888 334.562, 134.584 336.324 C 136.126 340.230, 157.368 352.588, 170.766 357.373 C 197.897 367.064, 232.356 366.923, 269.749 356.968 C 291.807 351.096, 322.488 338.576, 350.728 323.922 L 362.500 317.814 355.684 324.461 C 339.456 340.286, 316.530 355.386, 283 372.334 L 259.500 384.212 269.500 383.560 C 316.374 380.503, 364.444 358.846, 401.726 323.989 L 408.500 317.656 417.466 317.902 C 422.397 318.038, 426.759 318.351, 427.160 318.599 C 429.219 319.872, 410.100 359.002, 402.277 369.524 C 390.551 385.299, 375.704 394.810, 357.215 398.393 L 350.500 399.694 356.204 402.314 C 369.493 408.418, 388.661 410.930, 405.250 408.741 L 411 407.983 411 414.832 C 411 455.995, 394.082 483.392, 366.500 486.897 L 360.500 487.659 365.500 490.053 C 373.395 493.833, 391.189 493.635, 399.250 489.677 C 406.289 486.220, 414.721 478.668, 419.018 471.971 L 422.229 466.967 432.664 477.017 C 461.618 504.906, 499.520 530.027, 533 543.519 C 538.225 545.624, 542.844 547.635, 543.264 547.988 C 545.528 549.886, 528.034 569.877, 517.500 577.431 C 490.646 596.685, 454.699 600.311, 429 586.358 C 418.908 580.878, 419.041 581.229, 424.057 573.326 C 428.494 566.335, 434.966 552.594, 434.988 550.117 C 434.995 549.357, 431.466 552.111, 427.146 556.238 C 379.836 601.438, 303.961 602.639, 277.587 558.605 L 274.056 552.711 277.852 548.105 C 284.404 540.157, 298 519.528, 298 517.535 C 298 517.339, 294.962 519.232, 291.250 521.742 C 252.362 548.038, 198.657 549.736, 166.310 525.693 C 148.287 512.297, 141.710 492.281, 149.318 473.981 C 157.358 454.639, 177.779 436.118, 206.977 421.686 C 214.795 417.821, 218.749 415.383, 217.568 415.155 C 214.233 414.513, 162.977 417.021, 148 418.560 C 116.408 421.805, 79.322 427.683, 47.609 434.471 C 28.225 438.620, 28.225 438.620, 39 439.329 C 50.032 440.056, 112.957 441.865, 124 441.774 C 145.373 441.596, 145.217 441.499, 138.095 450.461 C 125.006 466.932, 120.601 477.925, 120.649 494 C 120.701 511.373, 125.829 523.272, 139.209 537.069 C 162.446 561.029, 197.544 570.050, 239.971 562.966 C 247.302 561.742, 246.298 561.060, 252 571.131 C 258.657 582.889, 272.115 595.595, 286 603.229 C 316.359 619.923, 360.428 619.661, 396.124 602.577 L 401.749 599.885 406.582 602.950 C 429.580 617.535, 468.088 619.945, 500 608.797 C 523.967 600.425, 545.631 584.346, 560.202 564.115 L 566.511 555.356 574.005 557.206 C 603.310 564.442, 630.366 565.719, 646 560.605 C 681.594 548.962, 712.793 514.508, 724.458 473.961 C 728.150 461.126, 728.029 454.282, 723.940 444.783 C 709.186 410.506, 707.365 404.539, 706.494 387.620 L 705.832 374.741 708.166 375.321 C 713.800 376.720, 734.077 377.166, 743 376.088 C 772.299 372.547, 800.169 356.742, 808.893 338.720 C 811.653 333.019, 811.601 332.463, 807.539 324.384 C 798.350 306.108, 775.596 289.418, 742.786 276.889 C 738.229 275.148, 734.322 273.571, 734.104 273.383 C 733.886 273.195, 735.790 268.869, 738.335 263.770 C 752.406 235.579, 750.051 203.637, 731.929 176.878 C 717.096 154.976, 695 141.975, 667.022 138.689 L 656.746 137.482 654.526 130.991 C 642.629 96.202, 612.839 71.863, 571.244 62.951 C 561.770 60.921, 532.315 59.451, 524.500 60.618 M 461.965 325.250 C 456.899 333.457, 457.745 335.594, 467.500 339.232 C 501.972 352.086, 595.141 383, 599.409 383 C 606.051 383, 605.602 376.934, 598.750 374.080 C 592.397 371.434, 511.941 339.607, 485.678 329.350 C 463.973 320.874, 464.599 320.982, 461.965 325.250 M 686.030 334.099 C 686.001 338.593, 685.777 338.914, 676.250 348.126 C 670.888 353.312, 662.563 360.617, 657.750 364.360 C 648.964 371.194, 647.515 373.523, 650.505 376.004 C 652.396 377.574, 667.436 368.485, 685.750 354.707 C 691.750 350.193, 692.054 348.858, 689.409 338.644 C 687.157 329.949, 686.068 328.483, 686.030 334.099 M 492.551 362.511 C 491.595 368.880, 492.827 379.207, 495.484 387.109 C 509.498 428.787, 568.076 437.554, 586.499 400.730 C 591 391.732, 591.048 389.335, 586.750 388.197 C 583.604 387.365, 583.455 387.465, 582.112 391.333 C 580.267 396.642, 573.537 403.231, 568.384 404.770 C 551.697 409.756, 538.241 399.175, 537.202 380.252 L 536.749 372.004 516.125 365.371 C 504.781 361.723, 494.993 358.545, 494.373 358.309 C 493.690 358.049, 492.971 359.706, 492.551 362.511 M 686.310 363.647 C 685.451 363.993, 685.259 366.968, 685.621 374.313 C 686.082 383.681, 685.934 384.822, 683.784 388.500 C 678.998 396.690, 670.203 395.277, 665.107 385.500 C 663.673 382.750, 662.402 380.327, 662.281 380.115 C 661.823 379.307, 657 383.105, 657.001 384.273 C 657.005 390.295, 667.900 405.805, 674.306 408.906 C 687.846 415.461, 695.642 404.194, 692.942 381.973 C 691.107 366.863, 689.480 362.368, 686.310 363.647 M 649.153 455.750 C 647.108 459.653, 649.547 461.790, 664.267 468.987 C 672.154 472.844, 679.212 476, 679.950 476 C 681.314 476, 681.170 481.193, 679.388 496.358 C 678.835 501.058, 678.998 502.062, 680.402 502.601 C 684.193 504.056, 686.859 497.962, 690.508 479.500 C 690.973 477.148, 692.359 475.777, 696.931 473.151 C 709.395 465.991, 715.373 458.773, 711.800 455.200 C 709.614 453.014, 650.314 453.534, 649.153 455.750 M 570.437 469.500 C 571.579 475.146, 579.865 490.495, 585.343 497.112 C 604.807 520.624, 645.002 529.674, 671.137 516.431 C 678.549 512.675, 678.119 512, 668.309 511.996 C 635.251 511.981, 593.346 493.739, 573.462 470.706 C 569.848 466.520, 569.833 466.514, 570.437 469.500" fill="#08090B" fill-rule="evenodd"/></g></svg>`;

  let host,
    root,
    wrap,
    btn,
    gifBtn,
    panel,
    video = null,
    hideTimer = 0,
    raf = 0,
    open = false;

  function build() {
    host = document.createElement("baadash-overlay");
    host.style.cssText =
      "all:initial;position:fixed;inset:0 auto auto 0;width:0;height:0;z-index:2147483647;";
    root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      @font-face { font-family: "BaaDash Noto Sans SC"; src: url("${chrome.runtime.getURL("fonts/NotoSansSC-Variable.woff2")}") format("woff2"); font-style: normal; font-weight: 100 900; font-display: swap; }
      :host { all: initial; }
      * { box-sizing: border-box; font-family: "BaaDash Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", "Segoe UI", system-ui, sans-serif; }
      /* max-content: anchored at the video's right edge, the wrap would
         otherwise only get the space left before the window edge, and on a
         large video "Download video" broke onto two lines. */
      .wrap { position: fixed; width: max-content; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; transform: translateX(-100%); opacity: 0; transition: opacity .15s; pointer-events: none; }
      .wrap.on { opacity: 1; pointer-events: auto; }
      .gifbtn, .btn .chev, .btn > span { display:none; }
      .wrap:hover .gifbtn, .wrap.open .gifbtn, .wrap:hover .btn > span, .wrap.open .btn > span, .wrap:hover .btn .chev, .wrap.open .btn .chev { display:inline-flex; }
      .btn { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px 0 8px; white-space: nowrap; border: 0; border-radius: 9px;
        background: rgba(20, 21, 26, .86); color: #fff; font-size: 12.5px; font-weight: 600; letter-spacing: -.005em; cursor: pointer;
        box-shadow: 0 0 0 1px rgba(255,255,255,.12), 0 6px 20px rgba(0,0,0,.35); backdrop-filter: blur(14px) saturate(1.5); }
      .btn:hover { background: rgba(30, 31, 38, .94); }
      .btn .chev { opacity: .6; margin-left: 2px; transition: transform .15s; }
      .wrap.open .btn .chev { transform: rotate(180deg); }
      .panel { width: 320px; padding: 6px; border-radius: 12px; background: rgba(22, 23, 28, .94); color: #eef0f3;
        box-shadow: 0 0 0 1px rgba(255,255,255,.1), 0 16px 48px rgba(0,0,0,.5); backdrop-filter: blur(18px) saturate(1.5); display: none; }
      .wrap.open .panel { display: block; animation: pop .14s ease-out; }
      @keyframes pop { from { opacity: 0; transform: translateY(-4px); } }
      .head { padding: 6px 8px 6px; font-size: 11.5px; font-weight: 600; color: #8a8e98; }
      .item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px; border: 0; border-radius: 8px; background: none; color: inherit; text-align: left; cursor: pointer; }
      .item:hover { background: rgba(255,255,255,.07); }
      .item[disabled] { cursor: default; opacity: .55; }
      .item[disabled]:hover { background: none; }
      .tag { flex: none; min-width: 42px; height: 20px; padding: 0 6px; border-radius: 5px; display: grid; place-items: center; font-size: 10.5px; font-weight: 700; letter-spacing: .03em;
        background: rgba(255,255,255,.1); color: #e6e8ec; }
      .tag.stream { background: rgba(255,255,255,.08); color: #8a8e98; }
      .meta { flex: 1; min-width: 0; }
      .meta b { display: block; font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .meta span { display: block; margin-top: 1px; font-size: 11.5px; color: #8a8e98; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      /* quality list: one short row each, size on the right */
      .panel.q { width: 210px; }
      .qrow { display: flex; align-items: baseline; gap: 12px; width: 100%; height: 30px; padding: 0 10px; border: 0; border-radius: 7px; background: none; color: #eef0f3; cursor: pointer; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; align-items: center; }
      .qrow:hover { background: rgba(255,255,255,.08); }
      .qrow .sz { margin-left: auto; font-weight: 500; font-size: 12px; color: #8a8e98; }
      .qsep { height: 1px; margin: 4px 6px; background: rgba(255,255,255,.08); }
      .msg { padding: 10px 8px 12px; font-size: 12.5px; color: #a4a8b1; line-height: 1.5; }
      .msg.ok { color: #4cb782; } .msg.err { color: #eb6b6b; }
      .actions { display: flex; gap: 6px; }
      .gifbtn { padding: 0 10px; color: #ff70ac; font-weight: 750; }
      .gif-title { padding: 7px 8px 2px; font-size: 14px; font-weight: 700; }
      .gif-note { padding: 3px 8px 10px; color: #9ca1ac; font-size: 11.5px; line-height: 1.55; }
      .gif-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; padding: 2px 8px 10px; }
      .gif-field { display: grid; gap: 5px; color: #a4a8b1; font-size: 11px; }
      .gif-field input, .gif-field select { width: 100%; height: 31px; padding: 0 8px; border: 1px solid rgba(255,255,255,.12); border-radius: 7px; outline: none; background: #30323b; color: #f3f4f6; font-size: 12px; color-scheme: dark; }
      .gif-field input:focus, .gif-field select:focus { border-color: #ff0077; }
      .gif-go { width: calc(100% - 16px); height: 34px; margin: 0 8px 6px; border: 0; border-radius: 8px; background: #ff0077; color: #fff; font-size: 12.5px; font-weight: 650; cursor: pointer; }
      .gif-go:hover { background: #e6006c; }
    </style>
    <div class="wrap"><div class="actions"><button class="btn gifbtn" title="下载视频并另存为 GIF">GIF</button><button class="btn" title="使用 BaaDash 下载">${LOGO}<span>下载视频</span><svg class="chev" width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg></button></div><div class="panel"></div></div>`;
    wrap = root.querySelector(".wrap");
    btn = root.querySelector(".btn:not(.gifbtn)");
    gifBtn = root.querySelector(".gifbtn");
    panel = root.querySelector(".panel");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggle();
    });
    gifBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      gifMenu();
    });
    panel.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = e.target.closest(".item:not([disabled])");
      if (item) grab(item.dataset.url, item.dataset.name);
    });
    wrap.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    wrap.addEventListener("mouseleave", () => scheduleHide());
    mount();
  }

  function mount() {
    const parent = document.fullscreenElement || document.documentElement;
    if (host && host.parentNode !== parent) parent.append(host);
  }
  document.addEventListener("fullscreenchange", () => host && mount());

  const bytes = (n) => {
    if (!n) return "";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
  };
  const extOf = (url, mime) =>
    (/\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(new URL(url).pathname) ||
      [])[1]?.toLowerCase() ||
    (mime.split("/")[1] || "").replace(/^x-/, "").slice(0, 4) ||
    "mp4";
  const title = () =>
    (document.title || "video")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  const onX = () => /(^|\.)(x\.com|twitter\.com)$/i.test(location.hostname);
  // A player in X search results or the timeline belongs to a tweet, not to
  // the page URL. Sending x.com/search to yt-dlp can never download it.
  function pageMediaUrl() {
    if (onX()) {
      const article = video?.closest?.("article");
      const links = [
        ...(article?.querySelectorAll?.('a[href*="/status/"]') || []),
      ];
      for (const link of links) {
        try {
          const u = new URL(link.href, location.href);
          if (/^\/[^/]+\/status\/\d+/.test(u.pathname))
            return `https://x.com${u.pathname}`;
        } catch {}
      }
      const u = new URL(location.href);
      if (/^\/[^/]+\/status\/\d+/.test(u.pathname))
        return `${u.origin}${u.pathname}`;
    }
    return location.href;
  }

  function position() {
    if (!video || !wrap.classList.contains("on")) {
      raf = 0;
      return;
    }
    const r = video.getBoundingClientRect();
    if (
      r.width < MIN_W ||
      r.height < MIN_H ||
      r.bottom < 0 ||
      r.top > innerHeight
    ) {
      hide();
      raf = 0;
      return;
    }
    wrap.style.left = `${Math.min(innerWidth - 8, r.right - 10)}px`;
    wrap.style.top = `${Math.max(8, r.top + 10)}px`;
    raf = requestAnimationFrame(position);
  }
  // YouTube: once the pointer has rested on a video for a moment, ask the app
  // to look it up, so the download can start the moment a quality is picked.
  // Once per video; a quick pass of the mouse doesn't count.
  // leftAt: when the pointer last moved off the video (a resting pointer
  // sends no events, so "left" is what can be seen, not "still there").
  let prepTimer = 0,
    leftAt = 0;
  const prepared = new Set();
  function prepareSoon() {
    // Called on every mouse move: start the countdown once, don't restart it.
    if (prepTimer || !/(^|\.)youtube\.com$/i.test(location.hostname)) return;
    const started = performance.now();
    prepTimer = setTimeout(async () => {
      prepTimer = 0;
      // The pointer moved off during the countdown: it was only passing.
      if (leftAt > started && !open) return;
      const info = await askPage();
      if (!info?.id || info.live || prepared.has(info.id) || !video) return;
      prepared.add(info.id);
      chrome.runtime
        .sendMessage({
          type: "prepare",
          url: `https://www.youtube.com/watch?v=${info.id}`,
        })
        .catch(() => {});
    }, 1000);
  }

  function show(v) {
    if (!host) build();
    mount();
    if (video !== v) {
      video = v;
      setOpen(false);
    }
    prepareSoon();
    clearTimeout(hideTimer);
    if (!open) hideTimer = setTimeout(hide, 2000);
    wrap.classList.add("on");
    if (!raf) raf = requestAnimationFrame(position);
  }
  function hide() {
    candidate = null;
    clearTimeout(prepTimer);
    prepTimer = 0;
    wrap?.classList.remove("on");
    setOpen(false);
    video = null;
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    if (!open) hideTimer = setTimeout(hide, 1600);
  }
  function setOpen(v) {
    open = v;
    wrap?.classList.toggle("open", v);
    if (v) clearTimeout(hideTimer);
    else if (video) scheduleHide();
  }

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    panel.classList.remove("q");
    setOpen(true);
    if (/(^|\.)youtube\.com$/i.test(location.hostname) && (await youtubeMenu()))
      return;
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "media" });
    } catch {
      res = { items: [] };
    }
    // Any site: if the player loaded a stream (HLS or DASH), list its
    // qualities now. The oldest one is the main playlist with every quality.
    const hls = pickStream(res?.items || []);
    if (hls?.qualities?.length) {
      qualityMenu(hls.url, title(), hls.qualities);
      return;
    }
    if (hls && (await streamMenu(hls.url))) return;
    if (onVideoSite()) {
      // X's animated "GIFs" are ordinary short MP4s. Prefer the actual file
      // when the player exposed it; otherwise resolve the containing tweet.
      const file =
        onX() &&
        (res?.items || []).find(
          (m) =>
            m.kind === "file" &&
            /(^video\/|\.mp4(?:$|[?#]))/i.test(`${m.mime || ""} ${m.url}`),
        );
      if (file)
        return grab(
          file.url,
          `${title()}.${extOf(file.url, file.mime || "video/mp4")}`,
        );
      return grab(pageMediaUrl(), `${title()}.mp4`);
    }
    panel.innerHTML = `<div class="msg">正在查找可下载的文件…</div>`;
    const items = [...(res?.items || [])];
    const src = video?.currentSrc;
    if (src && /^https?:/i.test(src) && !items.some((m) => m.url === src))
      items.unshift({ url: src, kind: "file", mime: "video/mp4", size: 0 });
    const files = items.filter((m) => m.kind === "file");
    // A player loads its main playlist first, then one per quality: the
    // oldest stream is the main one, which lets BaaDash offer every quality.
    const stream = pickStream(items);
    const name = title();
    let html = "";
    if (files.length) {
      html += `<div class="head">此页面中的视频和音频</div>`;
      html += files
        .map((m) => {
          const ext = extOf(m.url, m.mime || "");
          const kind =
            /^audio/.test(m.mime) || /mp3|m4a|aac|ogg|opus|flac|wav/.test(ext)
              ? "音频"
              : "视频";
          return `<button class="item" data-url="${encodeURI(m.url).replace(/"/g, "%22")}" data-name="${name.replace(/"/g, "'")}.${ext}"><span class="tag">${ext.toUpperCase()}</span><span class="meta"><b>${kind}${m.size ? ` · ${bytes(m.size)}` : ""}</b><span>${new URL(m.url).hostname}</span></span></button>`;
        })
        .join("");
    }
    if (stream) {
      html += `<div class="head">流媒体</div><button class="item" data-url="${encodeURI(stream.url).replace(/"/g, "%22")}" data-name="${name.replace(/"/g, "'")}.mp4"><span class="tag stream">${stream.kind.toUpperCase()}</span><span class="meta"><b>当前视频</b><span>在 BaaDash 中选择清晰度</span></span></button>`;
    }
    if (!files.length && !stream)
      html = `<div class="msg">暂未找到可下载的文件。请先播放视频片刻，然后重试。</div>`;
    panel.innerHTML = html;
  }

  // Say what actually went wrong. The commonest case isn't BaaDash at all:
  // the extension was updated or reloaded, which cuts off pages that were
  // already open until they're reloaded.
  function failure(error) {
    const text = (s) =>
      s.replace(
        /[&<>]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
      );
    if (
      /context invalidated|receiving end does not exist/i.test(error) ||
      !chrome.runtime?.id
    )
      return "BaaDash 扩展已更新，请刷新此页面后重试。";
    if (/host not found|not allowed/i.test(error))
      return "此浏览器尚未配置 BaaDash，请先打开一次 BaaDash 应用，然后重试。";
    return `BaaDash 无法接管此下载：${text(error) || "应用没有响应"}。`;
  }

  // ---------- YouTube: qualities straight from the page ----------
  // yt.js (inside the page) reads what the player already has. Same choices
  // and format selectors as the app's own lookup, so either way matches.
  const askPage = () =>
    new Promise((resolve) => {
      const on = (e) => {
        if (e.source === window && e.data?.baadash === "yt-info") {
          removeEventListener("message", on);
          resolve(e.data);
        }
      };
      addEventListener("message", on);
      postMessage({ baadash: "yt-ask" }, "*");
      setTimeout(() => {
        removeEventListener("message", on);
        resolve(null);
      }, 800);
    });
  function ytQualities(formats) {
    const videos = formats.filter(
      (f) => f.mime.startsWith("video/") && f.height > 0,
    );
    const audios = formats.filter((f) => f.mime.startsWith("audio/"));
    const m4a = audios.filter((f) => f.mime.startsWith("audio/mp4"));
    const audioSize = Math.max(
      0,
      ...(m4a.length ? m4a : audios).map((f) => f.size),
    );
    const heights = [...new Set(videos.map((f) => f.height))].sort(
      (a, b) => b - a,
    );
    const list = heights.map((h) => {
      const at = videos.filter((f) => f.height === h);
      const best = at.reduce((a, b) => (b.bitrate > a.bitrate ? b : a));
      const fps = Math.max(...at.map((f) => f.fps));
      return {
        label: fps > 30.5 ? `${h}p${Math.round(fps)}` : `${h}p`,
        format: `bv*[height=${h}][vcodec^=avc1]+ba[ext=m4a]/bv*[height=${h}]+ba[ext=m4a]/bv*[height=${h}]+ba/b[height=${h}]/bv*[height<=${h}]+ba/b`,
        ext: "mp4",
        size: best.size ? best.size + audioSize : null,
      };
    });
    if (audios.length)
      list.push({
        label: "Audio only",
        format: "ba[ext=m4a]/ba",
        ext: m4a.length ? "m4a" : "webm",
        size: audioSize || null,
      });
    return list;
  }
  async function youtubeMenu() {
    const info = await askPage();
    if (!info?.id || info.live || !info.formats.length) return false;
    const qualities = ytQualities(info.formats);
    if (!qualities.length) return false;
    const name = (info.title || title())
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    // Just the video: a "list=" mix would make yt-dlp think about the playlist.
    const url = `https://www.youtube.com/watch?v=${info.id}`;
    qualityMenu(url, name, qualities);
    // Start the slow part now, unless hovering already did.
    if (!prepared.has(info.id)) {
      prepared.add(info.id);
      chrome.runtime.sendMessage({ type: "prepare", url }).catch(() => {});
    }
    return true;
  }

  function qualityMenu(url, name, qualities) {
    const label = (q) =>
      q.label === "Audio only"
        ? "仅音频"
        : q.label === "Best quality"
          ? "最佳画质"
          : q.label === "Original"
            ? "原始画质"
            : q.label;
    const row = (q, i) =>
      `<button class="qrow" data-q="${i}"><span>${label(q)}</span><span class="sz">${q.size ? bytes(q.size) : ""}</span></button>`;
    const audio = qualities.findIndex((q) => q.label === "Audio only");
    panel.classList.add("q");
    panel.innerHTML = qualities
      .map(
        (q, i) => (i === audio ? `<div class="qsep"></div>` : "") + row(q, i),
      )
      .join("");
    panel.querySelectorAll("[data-q]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const pick = Number(b.dataset.q);
        grab(url, `${name}.${qualities[pick].ext}`, { qualities, pick });
      }),
    );
  }
  async function streamMenu(url) {
    panel.innerHTML = `<div class="msg">正在读取清晰度…</div>`;
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "streamQualities", url });
    } catch {
      res = null;
    }
    if (!res?.qualities?.length) return false;
    qualityMenu(url, title(), res.qualities);
    return true;
  }

  // Convert a direct video file locally after downloading. Unlike Pixiv
  // ugoira (a ZIP of timed frames), this path is for ordinary MP4/WebM/etc.
  // There is no fixed duration cap: the user chooses the full video or a range.
  async function gifMenu() {
    panel.classList.remove("q");
    setOpen(true);
    const duration =
      Number.isFinite(video?.duration) && video.duration > 0
        ? Math.round(video.duration * 100) / 100
        : 0;
    panel.innerHTML = `<div class="gif-title">保存为 GIF</div>
      <div class="gif-note">默认转换整个视频并保留原尺寸；原视频也会保留，GIF 不含声音。</div>
      <div class="gif-grid">
        <label class="gif-field">开始（秒）<input id="gif-start" type="number" min="0" step="0.1" value="0"></label>
        <label class="gif-field">结束（秒，留空为片尾）<input id="gif-end" type="number" min="0" step="0.1" value="${duration || ""}"></label>
        <label class="gif-field">最长边<select id="gif-size"><option value="">原始尺寸</option><option value="1080">1080 像素</option><option value="720">720 像素</option><option value="480">480 像素</option></select></label>
        <label class="gif-field">帧率<select id="gif-fps"><option value="12">12 fps · 均衡</option><option value="10">10 fps · 较小</option><option value="15">15 fps</option><option value="20">20 fps</option><option value="24">24 fps</option><option value="30">30 fps</option></select></label>
        <label class="gif-field">色彩<select id="gif-colors"><option value="128">128 色 · 均衡</option><option value="256">256 色 · 更细腻</option><option value="64">64 色 · 较小</option></select></label>
      </div>
      <div class="gif-note">原始尺寸、较长片段和高帧率可能生成很大的文件，并需要更多转换时间。</div>
      <button class="gif-go">下载并转换</button>`;
    panel.querySelector(".gif-go").addEventListener("click", async () => {
      const start = Number(panel.querySelector("#gif-start").value || 0);
      const endValue = panel.querySelector("#gif-end").value.trim();
      const end = endValue ? Number(endValue) : null;
      if (
        !Number.isFinite(start) ||
        start < 0 ||
        (end !== null && (!Number.isFinite(end) || end <= start)) ||
        (duration && start >= duration)
      ) {
        panel.querySelector(".gif-note").textContent =
          "请检查时间范围：开始时间不能小于 0，结束时间必须晚于开始时间。";
        panel.querySelector(".gif-note").style.color = "#eb6b6b";
        return;
      }
      const gifOptions = {
        start,
        end,
        size: Number(panel.querySelector("#gif-size").value) || null,
        fps: Number(panel.querySelector("#gif-fps").value) || 12,
        colors: Number(panel.querySelector("#gif-colors").value) || 128,
      };
      panel.innerHTML = `<div class="msg">正在查找视频文件…</div>`;
      let res;
      try {
        res = await chrome.runtime.sendMessage({ type: "media" });
      } catch (e) {
        res = { error: String(e?.message || e) };
      }
      const source = /^https?:/i.test(video?.currentSrc || "")
        ? video.currentSrc
        : "";
      const direct = /\.(mp4|webm|mov|m4v|mkv|avi)(?:$|[?#])/i;
      const files = (res?.items || []).filter(
        (m) =>
          m.kind === "file" &&
          (/^video\//i.test(m.mime || "") || direct.test(m.url)),
      );
      const media =
        files.find((m) => m.url === source) ||
        (source && direct.test(source)
          ? { url: source, mime: "video/mp4" }
          : files[0]);
      const stream = pickStream(res?.items || []);
      // A blob: URL is only the player's local wrapper. Use the captured
      // stream, or the actual X/Twitter status URL, and let the app resolve it.
      const target =
        media?.url && /^https?:/i.test(media.url)
          ? {
              url: media.url,
              filename: `${title()}.${extOf(media.url, media.mime || "video/mp4")}`,
            }
          : stream?.url
            ? { url: stream.url, filename: `${title()}.mp4` }
            : onVideoSite()
              ? { url: pageMediaUrl(), filename: `${title()}.mp4` }
              : null;
      if (!target) {
        panel.innerHTML = `<div class="msg err">暂未找到此视频的文件或流媒体地址。请先播放片刻，再重试。</div>`;
        return;
      }
      let sent;
      try {
        sent = await chrome.runtime.sendMessage({
          type: "quick",
          items: [{ ...target, convertGif: true, gifOptions }],
        });
      } catch (e) {
        sent = { ok: false, error: String(e?.message || e) };
      }
      panel.innerHTML = sent?.ok
        ? `<div class="msg ok">已添加到 BaaDash ✓<br>下载后会按所选参数另存 GIF，原视频不会删除。</div>`
        : `<div class="msg err">${failure(sent?.error || "")}</div>`;
      setTimeout(() => {
        setOpen(false);
        scheduleHide();
      }, 2200);
    });
  }

  async function grab(url, filename, extra = {}) {
    panel.classList.remove("q");
    panel.innerHTML = `<div class="msg">正在发送到 BaaDash…</div>`;
    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: "grab",
        url: decodeURI(url),
        filename,
        ...extra,
      });
    } catch (e) {
      res = { ok: false, error: String(e?.message || e) };
    }
    panel.innerHTML = res?.ok
      ? `<div class="msg ok">已发送到 BaaDash ✓</div>`
      : `<div class="msg err">${failure(res?.error || "")}</div>`;
    setTimeout(() => {
      setOpen(false);
      scheduleHide();
    }, 1800);
  }

  // Find the video under the pointer, even when the site layers controls
  // on top of it.
  let last = 0,
    candidate = null,
    hoverTimer = 0,
    pointerWasVideo = false;
  window.__baadashPrefs?.subscribe(() => {
    clearTimeout(hoverTimer);
    candidate = null;
    hide();
  });
  document.addEventListener(
    "mousemove",
    async (e) => {
      if (!window.__baadashPrefs?.video) {
        clearTimeout(hoverTimer);
        candidate = null;
        hide();
        return;
      }
      const now = performance.now();
      if (now - last < 120) return;
      last = now;
      if (host && e.composedPath().includes(host)) return;
      const v = document
        .elementsFromPoint(e.clientX, e.clientY)
        .find((el) => el.tagName === "VIDEO");
      if (v) {
        pointerWasVideo = true;
        if (!v.currentSrc && v.readyState < 1) {
          clearTimeout(hoverTimer);
          candidate = null;
          if (video) hide();
          return;
        }
        const r = v.getBoundingClientRect();
        if (r.width < MIN_W || r.height < MIN_H) return;
        const full = document.fullscreenElement;
        if (
          full &&
          !(e.clientX > r.right - 72 && e.clientY < r.top + 72) &&
          !open
        ) {
          clearTimeout(hoverTimer);
          candidate = null;
          if (video) hide();
          return;
        }
        if (video === v) show(v);
        else if (candidate !== v) {
          clearTimeout(hoverTimer);
          candidate = v;
          hoverTimer = setTimeout(() => {
            if (candidate === v && window.__baadashPrefs?.video) show(v);
          }, 300);
        }
      } else {
        clearTimeout(hoverTimer);
        candidate = null;
        if (video && pointerWasVideo) {
          leftAt = now;
          scheduleHide();
        }
        pointerWasVideo = false;
      }
    },
    { passive: true },
  );
  document.addEventListener(
    "click",
    (e) => {
      if (open && host && !e.composedPath().includes(host)) setOpen(false);
    },
    true,
  );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(hoverTimer);
      candidate = null;
      hide();
    }
  });
})();
