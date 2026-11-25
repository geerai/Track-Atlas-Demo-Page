(function () {
  "use strict";

  const songs = window.MIDI_SONGS || [];
  const visibleSeconds = 12;
  const leadSeconds = 3;
  const scheduleAheadSeconds = 0.7;
  const trackIcons = { Piano: "🎹", Guitar: "🎸", Bass: "🎸", Drums: "🥁", Melody: "🎤" };
  const tabsElement = document.getElementById("song-tabs");
  const tracksElement = document.getElementById("tracks");
  const titleElement = document.getElementById("song-title");
  const subtitleElement = document.getElementById("song-subtitle");
  const styleElement = document.getElementById("song-style");
  const summaryElement = document.getElementById("transport-summary");
  const filenameElement = document.getElementById("filename");
  const playButton = document.getElementById("play-button");
  const volumeInput = document.getElementById("volume");
  const noticeElement = document.getElementById("audio-notice");
  const seekInput = document.getElementById("seek");
  const currentTimeElement = document.getElementById("current-time");
  const durationTimeElement = document.getElementById("duration-time");
  const rulerElement = document.getElementById("timeline-ruler");

  let songIndex = 0;
  let audioContext = null;
  let masterGain = null;
  let noiseBuffer = null;
  let playing = false;
  let pausedAt = 0;
  let playbackOrigin = 0;
  let schedulerTimer = 0;
  let animationFrame = 0;
  let trackCursors = [];
  let activeSources = [];
  let renderBaseStart = -1;
  let resumeAfterSeek = false;

  function song() { return songs[songIndex]; }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character];
    });
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(safe / 60);
    return minutes + ":" + String(safe % 60).padStart(2, "0");
  }

  function lowerBound(notes, time) {
    let low = 0;
    let high = notes.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (notes[middle].startSec < time) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function bpmLabel(selectedSong) {
    const bpms = selectedSong.tempoMap.map(function (tempo) { return Math.round(tempo.bpm); });
    const minimum = Math.min.apply(null, bpms);
    const maximum = Math.max.apply(null, bpms);
    return minimum === maximum ? minimum + " BPM" : minimum + "–" + maximum + " BPM";
  }

  function renderTabs() {
    tabsElement.innerHTML = songs.map(function (item, index) {
      const selected = index === songIndex;
      return '<button type="button" role="tab" aria-selected="' + selected + '" class="song-tab' + (selected ? " active" : "") + '" data-song="' + index + '"><span>0' + (index + 1) + "</span>" + escapeHtml(item.title) + "</button>";
    }).join("");
  }

  function renderSong() {
    const selectedSong = song();
    const totalNotes = selectedSong.tracks.reduce(function (sum, track) { return sum + track.noteCount; }, 0);
    titleElement.textContent = selectedSong.title;
    subtitleElement.textContent = selectedSong.subtitle;
    styleElement.textContent = selectedSong.style;
    styleElement.title = selectedSong.styleConfidence;
    filenameElement.textContent = selectedSong.file;
    summaryElement.innerHTML = '<div><strong>5</strong><span>tracks</span></div><div><strong>' + totalNotes.toLocaleString() + '</strong><span>source notes</span></div><div><strong>' + bpmLabel(selectedSong) + '</strong><span>source tempo</span></div>';
    durationTimeElement.textContent = formatTime(selectedSong.durationSeconds);

    tracksElement.innerHTML = selectedSong.tracks.map(function (track, index) {
      return '<article class="track-row" style="--track-color:' + escapeHtml(track.color) + '"><header class="track-meta"><div class="track-heading"><span class="track-icon" role="img" aria-label="' + escapeHtml(track.name) + '">' + trackIcons[track.name] + '</span><div><h3>' + escapeHtml(track.name) + '</h3><p>' + escapeHtml(track.instrument) + '</p></div></div><div class="track-stats"><strong>' + track.noteCount.toLocaleString() + '</strong><span>notes</span></div></header><div class="piano-roll" data-track="' + index + '" aria-label="' + escapeHtml(track.name + " notes using " + track.instrument) + '"><div class="notes-layer"></div><i class="playhead" aria-hidden="true"></i></div></article>';
    }).join("");

    renderTabs();
    renderBaseStart = -1;
    updateTimeline(pausedAt, true);
    updatePlayButton();
  }

  function windowStartFor(time) {
    const maximum = Math.max(0, song().durationSeconds - visibleSeconds);
    return Math.min(maximum, Math.max(0, time - leadSeconds));
  }

  function displayDuration(trackName, duration) {
    const minimum = { Piano: .16, Guitar: .18, Bass: .22, Drums: .10, Melody: .24 }[trackName] || .15;
    return Math.max(minimum, duration);
  }

  function rebuildVisibleNotes(baseStart) {
    const selectedSong = song();
    const rolls = document.querySelectorAll(".piano-roll");
    selectedSong.tracks.forEach(function (track, trackIndex) {
      const layer = rolls[trackIndex].querySelector(".notes-layer");
      const pitchSpan = Math.max(1, track.pitchMax - track.pitchMin + 1);
      const searchStart = Math.max(0, baseStart - 4);
      const renderEnd = baseStart + visibleSeconds + 5;
      let index = lowerBound(track.notes, searchStart);
      const markup = [];
      while (index < track.notes.length && track.notes[index].startSec <= renderEnd) {
        const note = track.notes[index];
        if (note.startSec + note.durationSec >= baseStart - 1) {
          const left = (note.startSec - baseStart) / visibleSeconds * 100;
          const width = displayDuration(track.name, note.durationSec) / visibleSeconds * 100;
          const bottom = (note.pitch - track.pitchMin) / pitchSpan * 82 + 7;
          const opacity = .45 + note.velocity / 127 * .55;
          markup.push('<i class="midi-note" title="' + formatTime(note.startSec) + ' · MIDI ' + note.pitch + ' · ' + note.durationSec.toFixed(2) + 's" style="left:' + left + '%;width:' + width + '%;bottom:' + bottom + '%;opacity:' + opacity + '"></i>');
        }
        index += 1;
      }
      layer.innerHTML = markup.join("");
    });
  }

  function renderRuler(windowStart) {
    const marks = [];
    const firstMark = Math.ceil(windowStart / 3) * 3;
    for (let mark = firstMark; mark <= windowStart + visibleSeconds; mark += 3) {
      const left = (mark - windowStart) / visibleSeconds * 100;
      marks.push('<span style="left:' + left + '%">' + formatTime(mark) + '</span>');
    }
    rulerElement.innerHTML = marks.join("");
  }

  function updateTimeline(time, force) {
    const selectedSong = song();
    const boundedTime = Math.min(selectedSong.durationSeconds, Math.max(0, time));
    const windowStart = windowStartFor(boundedTime);
    const nextBase = Math.floor(windowStart / 4) * 4;
    if (force || nextBase !== renderBaseStart) {
      renderBaseStart = nextBase;
      rebuildVisibleNotes(renderBaseStart);
    }

    const shift = (windowStart - renderBaseStart) / visibleSeconds * 100;
    document.querySelectorAll(".notes-layer").forEach(function (layer) {
      layer.style.transform = "translateX(-" + shift + "%)";
    });
    const playheadPercent = (boundedTime - windowStart) / visibleSeconds * 100;
    document.querySelectorAll(".playhead").forEach(function (element) {
      element.style.left = Math.max(0, Math.min(100, playheadPercent)) + "%";
    });

    renderRuler(windowStart);
    currentTimeElement.textContent = formatTime(boundedTime);
    seekInput.value = String(Math.round(boundedTime / selectedSong.durationSeconds * 1000));
  }

  function getAudioContext() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is not supported");
      audioContext = new AudioContextClass();
      masterGain = audioContext.createGain();
      masterGain.gain.value = Number(volumeInput.value) / 100 * .34;
      masterGain.connect(audioContext.destination);

      noiseBuffer = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * .12), audioContext.sampleRate);
      const noise = noiseBuffer.getChannelData(0);
      for (let index = 0; index < noise.length; index += 1) noise[index] = Math.random() * 2 - 1;
    }
    return audioContext;
  }

  function trackGain(name) {
    return { Piano: .12, Guitar: .08, Bass: .16, Drums: .08, Melody: .16 }[name] || .1;
  }

  function rememberSource(node, endTime) {
    activeSources.push({ node: node, endTime: endTime });
  }

  function scheduleTone(trackName, note, when) {
    const context = audioContext;
    const frequency = 440 * Math.pow(2, (note.pitch - 69) / 12);
    const minimum = { Piano: .16, Guitar: .18, Bass: .22, Melody: .24 }[trackName] || .15;
    const maximum = trackName === "Melody" ? 3.2 : trackName === "Bass" ? 2.2 : 1.8;
    const duration = Math.min(maximum, Math.max(minimum, note.durationSec * .98));
    const gain = context.createGain();
    const velocity = Math.max(.04, note.velocity / 127) * trackGain(trackName);
    gain.gain.setValueAtTime(.0001, when);
    gain.gain.exponentialRampToValueAtTime(velocity, when + .01);
    gain.gain.setValueAtTime(Math.max(.0001, velocity * .7), Math.max(when + .012, when + duration * .72));
    gain.gain.exponentialRampToValueAtTime(.0001, when + duration);

    const oscillator = context.createOscillator();
    oscillator.frequency.setValueAtTime(frequency, when);
    oscillator.type = trackName === "Bass" ? "square" : trackName === "Guitar" ? "sawtooth" : trackName === "Melody" ? "sine" : "triangle";

    if (trackName === "Bass" || trackName === "Guitar") {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = trackName === "Bass" ? 620 : 1650;
      oscillator.connect(filter);
      filter.connect(gain);
    } else {
      oscillator.connect(gain);
    }
    gain.connect(masterGain);
    oscillator.start(when);
    oscillator.stop(when + duration + .03);
    rememberSource(oscillator, when + duration + .03);
  }

  function scheduleDrum(note, when) {
    const context = audioContext;
    if (note.pitch <= 40) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(105, when);
      oscillator.frequency.exponentialRampToValueAtTime(43, when + .14);
      gain.gain.setValueAtTime(.15, when);
      gain.gain.exponentialRampToValueAtTime(.0001, when + .16);
      oscillator.connect(gain);
      gain.connect(masterGain);
      oscillator.start(when);
      oscillator.stop(when + .17);
      rememberSource(oscillator, when + .17);
      return;
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = "highpass";
    filter.frequency.value = note.pitch >= 50 ? 4800 : 1350;
    gain.gain.setValueAtTime(note.pitch >= 50 ? .035 : .07, when);
    gain.gain.exponentialRampToValueAtTime(.0001, when + .09);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    source.start(when);
    source.stop(when + .1);
    rememberSource(source, when + .1);
  }

  function stopActiveSources() {
    activeSources.forEach(function (entry) {
      try { entry.node.stop(); } catch (error) { /* already stopped */ }
    });
    activeSources = [];
  }

  function scheduleUpcomingNotes() {
    if (!playing) return;
    const selectedSong = song();
    const nowSongTime = audioContext.currentTime - playbackOrigin;
    const horizon = nowSongTime + scheduleAheadSeconds;
    activeSources = activeSources.filter(function (entry) { return entry.endTime > audioContext.currentTime - .1; });

    selectedSong.tracks.forEach(function (track, trackIndex) {
      let cursor = trackCursors[trackIndex];
      while (cursor < track.notes.length && track.notes[cursor].startSec < horizon) {
        const note = track.notes[cursor];
        if (note.startSec >= nowSongTime - .08) {
          const when = playbackOrigin + note.startSec;
          if (track.name === "Drums") scheduleDrum(note, when);
          else scheduleTone(track.name, note, when);
        }
        cursor += 1;
      }
      trackCursors[trackIndex] = cursor;
    });
  }

  function initializeCursors(time) {
    trackCursors = song().tracks.map(function (track) { return lowerBound(track.notes, Math.max(0, time - .02)); });
  }

  function updatePlayButton() {
    playButton.classList.toggle("playing", playing);
    playButton.innerHTML = playing ? '<span aria-hidden="true">Ⅱ</span> Pause' : '<span aria-hidden="true">▶</span> Play original tempo';
    playButton.setAttribute("aria-label", playing ? "Pause MIDI playback" : "Play MIDI at original tempo");
  }

  async function startPlayback() {
    const context = getAudioContext();
    await context.resume();
    if (pausedAt >= song().durationSeconds - .02) pausedAt = 0;
    stopActiveSources();
    clearInterval(schedulerTimer);
    playing = true;
    playbackOrigin = context.currentTime - pausedAt;
    initializeCursors(pausedAt);
    scheduleUpcomingNotes();
    schedulerTimer = window.setInterval(scheduleUpcomingNotes, 80);
    updatePlayButton();
    noticeElement.classList.add("active");
    noticeElement.innerHTML = '<span class="speaker" aria-hidden="true">◖)))</span>Playing <strong>' + escapeHtml(song().title) + '</strong> at ' + bpmLabel(song()) + ' from the source MIDI tempo map.';
    cancelAnimationFrame(animationFrame);
    animate();
  }

  function pausePlayback(updateNotice) {
    if (playing && audioContext) pausedAt = Math.min(song().durationSeconds, Math.max(0, audioContext.currentTime - playbackOrigin));
    playing = false;
    clearInterval(schedulerTimer);
    cancelAnimationFrame(animationFrame);
    stopActiveSources();
    updatePlayButton();
    updateTimeline(pausedAt, false);
    if (updateNotice !== false) {
      noticeElement.classList.remove("active");
      noticeElement.innerHTML = '<span class="speaker" aria-hidden="true">◖))</span>Paused at <strong>' + formatTime(pausedAt) + '</strong>. Press Play to continue at the original tempo.';
    }
  }

  function resetPlayback() {
    pausePlayback(false);
    pausedAt = 0;
    renderBaseStart = -1;
    updateTimeline(0, true);
    noticeElement.classList.remove("active");
    noticeElement.innerHTML = '<span class="speaker" aria-hidden="true">◖))</span>Click <strong>Play original tempo</strong>. Timing follows the MIDI tempo map and the note window scrolls with the song.';
  }

  function animate() {
    if (!playing) return;
    const current = audioContext.currentTime - playbackOrigin;
    if (current >= song().durationSeconds) {
      pausedAt = song().durationSeconds;
      pausePlayback(false);
      noticeElement.classList.remove("active");
      noticeElement.innerHTML = '<span class="speaker" aria-hidden="true">✓</span>Playback complete. Press Play to start again.';
      return;
    }
    pausedAt = current;
    updateTimeline(current, false);
    animationFrame = requestAnimationFrame(animate);
  }

  tabsElement.addEventListener("click", function (event) {
    const button = event.target.closest("[data-song]");
    if (!button) return;
    resetPlayback();
    songIndex = Number(button.dataset.song);
    pausedAt = 0;
    renderSong();
  });

  playButton.addEventListener("click", function () {
    if (playing) pausePlayback(true);
    else startPlayback().catch(function () {
      noticeElement.classList.remove("active");
      noticeElement.textContent = "Audio could not start. Check that this browser tab is not muted, then click Play original tempo again.";
    });
  });

  seekInput.addEventListener("pointerdown", function () {
    resumeAfterSeek = playing;
    if (playing) pausePlayback(false);
  });
  seekInput.addEventListener("input", function () {
    pausedAt = Number(seekInput.value) / 1000 * song().durationSeconds;
    renderBaseStart = -1;
    updateTimeline(pausedAt, true);
  });
  seekInput.addEventListener("change", function () {
    if (resumeAfterSeek) startPlayback();
    resumeAfterSeek = false;
  });

  volumeInput.addEventListener("input", function () {
    if (masterGain && audioContext) masterGain.gain.setTargetAtTime(Number(volumeInput.value) / 100 * .34, audioContext.currentTime, .02);
  });

  if (!songs.length) {
    noticeElement.textContent = "MIDI data could not be loaded. Keep data.js in the same folder as index.html.";
    playButton.disabled = true;
  } else {
    renderSong();
  }
})();
