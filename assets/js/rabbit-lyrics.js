/*
 * Rabbit Lyrics
 *
 * JavaScript audio and timed lyrics synchronizer. No jQuery required.
 *
 * License: GNU General Public License version 3
 * Author: Guo Yunhe <yunhe.guo@protonmail.com>
 * Home page: https://gitlab.com/guoyunhe/rabbit-lyrics
 * Documentation: https://gitlab.com/guoyunhe/rabbit-lyrics/wiki
 * Report bugs: https://gitlab.com/guoyunhe/rabbit-lyrics/issues
 */

/**
 * Rabbit Lyrics main class
 *
 * @prop {HTMLElement} element
 * @prop {HTMLMediaElement} mediaElement
 * @prop {HTMLElement[]} lineElements
 * @prop {number} scrollerInterval
 *      Used to force stop previous scroller interval and set new interval
 * @prop {number} scrollerIntervalStep
 *      How long scroller interval should be executed, in milliseconds
 * @prop {number} scrollerIntervalDuration
 *      How long scroller interval could work.
 * @prop {number} scrollerTimer
 *      Countdown timer (ms) for scrolling animation.
 */
export default class RabbitLyrics {
  /**
   * Constructor
   * @param {Object} options
   * @param {HTMLElement} options.element The block this contains lyrics
   * @param {HTMLMediaElement} options.mediaElement The audio or video element to synchronize
   * @param {string} options.viewMode Modes of lyrics view box, available values: default, mini, full
   * @param {string} options.alignment Lyrics text alighment, available values: left, center, right
   * @param {number} options.height Height of lyrics. Only works with default view mode
   */
  constructor(options) {
    this.element = options.element;

    if (this.element.classList.contains("rabbit-lyrics--enabled")) {
      return;
    }

    this.element.classList.add("rabbit-lyrics");

    if (options.mediaElement) {
      this.mediaElement = options.mediaElement;
    } else {
      this.mediaElement = this.findMediaElementBefore(this.element);
    }

    if (options.viewMode) {
      this.viewMode = options.viewMode;
    } else {
      this.viewMode = "default";
    }
    this.element.classList.add("rabbit-lyrics--" + this.viewMode);

    if (this.viewMode !== "full" && options.height) {
      this.element.style.height = options.height + "px";
    }

    if (options.alignment) {
      this.element.style.textAlign = options.alignment;
    }

    this.scrollerIntervalDuration = 200;
    this.scrollerIntervalStep = 10;
    this.lineElements = [];

    // Bind this to event handlers
    this.setStatus = this.setStatus.bind(this);
    this.synchronize = this.synchronize.bind(this);
    this.scroll = this.scroll.bind(this);

    this.parseLyrics();
    this.enableLyrics();
  }

  /**
   * Find first audio or video element before lyrics element. Only used when
   * no mediaElement was specified. If nothing was found, return null.
   * @param {HTMLElement} element The start point element
   * @return {HTMLMediaElement|null}
   */
  findMediaElementBefore(element) {
    if (!element) {
      return null;
    }

    let previousElement = element.previousElementSibling;
    // First, lookup siblings before
    while (previousElement) {
      if (
        previousElement.tagName.toLowerCase() === "audio" ||
        previousElement.tagName.toLowerCase() === "video"
      ) {
        return previousElement;
      } else {
        const mediaChildren = previousElement.querySelector("audio, video");
        if (mediaChildren) {
          return mediaChildren[mediaChildren.length - 1];
        }
      }
      previousElement = previousElement.previousElementSibling;
    }

    if (element.parentElement) {
      return this.findMediaElementBefore(element.parentElement);
    } else {
      return null;
    }
  }

  parseLyrics() {
    // Do not do anything if no lyrics element was found
    if (!this.element) {
      return this;
    }

    let lines = this.element.textContent.trim().split("\n");
    this.element.textContent = "";

    var offset = 0;
    var parsed_lines = [];
    for(let line_no = 0; line_no < lines.length; ++line_no) {
      var line = lines[line_no].trim();

      // try match offset
      let match_offset = line.match(/\[offset:\-?\d+\]/);
      if(match_offset && match_offset.length != 0) {
        offset = parseInt(line.match(/\-?\d+/))*0.001;
        continue;
      }

      // match timestamps
      let timestamps = line.match(/\[\d+:\d+\.\d+\]/g) || [];
      line = line.replace(/\[\d+:\d+\.\d+\]/g, "");

      // push into parsed_lines
      for(let stamp_no = 0; stamp_no < timestamps.length; ++stamp_no) {
        parsed_lines.push({timestamp: timestamps[stamp_no], content: line});
      }
    }

    parsed_lines.sort(function(a, b){ return (a.timestamp < b.timestamp ? -1 : 1) });

    var last_time = 0;
    for(let line_no = 0; line_no < parsed_lines.length; ++line_no) {
      let lineElement = document.createElement("div");
      lineElement.className = "rabbit-lyrics__line";
      this.element.appendChild(lineElement);
      this.lineElements.push(lineElement);
      lineElement.innerHTML = parsed_lines[line_no].content;
      lineElement.dataset.start = this.decodeTimeStamp(parsed_lines[line_no].timestamp) + offset;
      if(line_no != parsed_lines.length - 1)
        lineElement.dataset.end = this.decodeTimeStamp(parsed_lines[line_no+1].timestamp) + offset;
      else
        lineElement.dataset.end = Infinity;
    }
  }

  /**
   * Enable lyrics playback
   */
  enableLyrics() {
    // Do not do anything if no media element was found
    if (!this.mediaElement) {
      return this;
    }

    // Rest scroll bar
    this.element.scrollTop = 0;

    // Bind playback update events
    this.mediaElement.ontimeupdate = this.synchronize;

    this.mediaElement.onplay = this.setStatus;
    this.mediaElement.onplaying = this.setStatus;
    this.mediaElement.onpause = this.setStatus;
    this.mediaElement.onwaiting = this.setStatus;
    this.mediaElement.onended = this.setStatus;

    // Add enabled status class. Avoid initializing the same element twice
    this.element.classList.add("rabbit-lyrics--enabled");

    return this;
  }

  /**
   *
   * @param {Event} e Media element event
   */
  setStatus(e) {
    let status; // playing, paused, waiting, ended
    switch (e.type) {
      case 'play':
      case 'playing':
        status = 'playing';
        break;
      case 'pause':
        status = 'paused';
        break;
      case 'waiting':
        status = 'waiting';
        break;
      case 'ended':
        status = 'ended';
        break;
    }
    this.element.classList.remove("rabbit-lyrics--playing", "rabbit-lyrics--paused", "rabbit-lyrics--waiting", "rabbit-lyrics--ended");
    if (status) {
      this.element.classList.add("rabbit-lyrics--" + status);
    }
  }

  /**
   * Synchronize media element time and lyrics lines
   */
  synchronize() {
    let time = this.mediaElement.currentTime;
    let changed = false; // If here are active lines changed
    let activeLineElements = [];

    this.lineElements.forEach(element => {
      if (time >= element.dataset.start && time <= element.dataset.end) {
        // If line should be active
        if (!element.classList.contains("rabbit-lyrics__line--active")) {
          // If it hasn't been activated
          changed = true;
          element.classList.add("rabbit-lyrics__line--active");
        }
        activeLineElements.push(element);
      } else {
        // If line should be inactive
        if (element.classList.contains("rabbit-lyrics__line--active")) {
          // If it hasn't been deactivated
          changed = true;
          element.classList.remove("rabbit-lyrics__line--active");
        }
      }
    });

    if (changed && activeLineElements.length > 0) {
      // Calculate scroll top. Vertically align active lines in middle
      let activeLinesOffsetTop =
        (activeLineElements[0].offsetTop +
          activeLineElements[activeLineElements.length - 1].offsetTop +
          activeLineElements[activeLineElements.length - 1].offsetHeight) /
        2;
      this.scrollTop = activeLinesOffsetTop - this.element.clientHeight / 2;

      // Start scrolling animation
      clearInterval(this.scrollerInterval);
      this.scrollerTimer = this.scrollerIntervalDuration;
      this.scrollerInterval = setInterval(
        this.scroll,
        this.scrollerIntervalStep
      );
    }
  }

  /**
   * One step of scrolling animation
   */
  scroll() {
    // If it is already scrolled to position, stop animation interval
    if (this.scrollerTimer <= 0) {
      clearInterval(this.scrollerInterval);
      return;
    }

    let distance = this.scrollTop - this.element.scrollTop;
    let movement = (distance * this.scrollerIntervalStep) / this.scrollerTimer;

    this.element.scrollTop += movement;

    this.scrollerTimer -= this.scrollerIntervalStep;
  }

  /**
   * Convert time stamp to seconds
   * @param {string} timestamp Lyrics time stamp, in format [2:17.88] or [1:03:45.32]
   * @return {number} Time in seconds, float number
   */
  decodeTimeStamp(timestamp) {
    if (!timestamp || typeof timestamp !== "string") return 0;

    let results;

    // [hh:mm:ss.xx] format, used by some long audio books
    results = timestamp.match(/\[(\d+):(\d+):(\d+\.\d+)\]/);
    if (results && results.length === 4) {
      return (
        parseInt(results[1]) * 60 * 60 +
        parseInt(results[2]) * 60 +
        parseFloat(results[3])
      );
    }

    // [mm:ss.xx] format, widely used for songs
    results = timestamp.match(/\[(\d+):(\d+\.\d+)\]/);
    if (results && results.length === 3) {
      return parseInt(results[1]) * 60 + parseFloat(results[2]);
    }

    return 0;
  }
}

// Support HTML syntax (doesn't work in older IEs)
document.addEventListener(
  "DOMContentLoaded",
  function() {
    let elements = document.getElementsByClassName("rabbit-lyrics");

    for (let i = 0; i < elements.length; i++) {
      let element = elements[i];
      let mediaElement = document.querySelector(element.dataset.media);
      let { viewMode, height, alignment } = element.dataset;
      let options = {
        element,
        mediaElement,
        viewMode,
        height,
        alignment
      };

      new RabbitLyrics(options);
    }
  },
  false
);