"use strict";

/*
  Loop Together — script.js
  Part 1: shows the commit history table (index.html)
  Part 2: runs the two-track sampler (instrument.html)
*/

const $ = selector => document.querySelector(selector);


/* ========== Part 1: commit history ========== */

// Split CSV text into rows of cells.
// A cell in "quotes" may contain commas and new lines; "" inside it means one quote mark.
function parseCSV(text) {
  const rows = [[""]];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const row = rows[rows.length - 1];
    if (char === '"' && quoted && text[i + 1] === '"') { row[row.length - 1] += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) row.push("");
    else if (char === "\n" && !quoted) rows.push([""]);
    else if (char !== "\r" || quoted) row[row.length - 1] += char;
  }
  return rows.filter(row => row.join("").trim() !== ""); // drop blank lines
}

// Load commit_history.csv and show it as a table. If the file is missing, say so.
async function showCommitHistory() {
  const status = $("#history-status");
  try {
    const response = await fetch("commit_history.csv", { cache: "no-store" });
    if (!response.ok) throw new Error("Final commit history has not been added yet. Add commit_history.csv beside index.html.");

    const rows = parseCSV(await response.text());
    if (!/^author( name)?$/i.test(rows[0]?.[0].trim())) {
      rows.unshift(["Author", "Author Date", "Subject", "Body"]); // add a header row if missing
    }

    const table = $("#history-table");
    const head = table.createTHead();
    const body = table.createTBody();
    rows.forEach((cells, i) => {
      const tr = (i === 0 ? head : body).insertRow();
      cells.forEach(text => {
        const cell = document.createElement(i === 0 ? "th" : "td");
        cell.textContent = text; // shown as plain text, never as HTML
        tr.append(cell);
      });
    });

    status.textContent = `${rows.length - 1} commit records loaded from the final version CSV.`;
    $("#history-download").hidden = false;
  } catch (error) {
    status.textContent = error.message;
  }
}

/* ========== Part 2: the instrument ========== */

const BEATS = 8;
const VOLUME = 0.38;    // overall loudness; leaves room for two tracks at full level
const SILENCE = 0.006;  // quieter than this counts as silence when trimming a recording

let tracks = [];        // Track A and Track B (built in setUpStudio)
let audio = null;       // the AudioContext, created on the first click
let speaker = null;     // live sound goes through this; swapping it cuts everything off
let playing = false;
let recording = null;   // { track, phase, recorder, timer } while recording
let timer = null;       // the scheduler's setInterval
let nextBeat = 0;       // the next beat to book (0–7)
let nextTime = 0;       // when that beat should sound, on the audio clock

const say = text => { $("#status").textContent = text; };
const isOn = button => button.getAttribute("aria-pressed") === "true";
const hasPattern = () => tracks.some(track => !track.muted && track.buttons.some(isOn));
const beatLength = () => 60 / $("#tempo").value; // seconds per beat

// Enable or disable controls to match what is happening.
function update() {
  const busy = playing || recording !== null;
  $("#play").disabled = busy || !hasPattern();
  $("#export").disabled = busy || !hasPattern();
  $("#stop").disabled = !playing && recording?.phase !== "recording";
  $("#tempo").disabled = busy;
  $("#state").textContent = playing ? "LOOP IS PLAYING" : recording ? recording.phase.toUpperCase() : "READY TO PLAY";

  tracks.forEach(track => {
    const isRecording = recording?.track === track && recording.phase === "recording";
    track.recordButton.textContent = isRecording ? "■ Finish" : "● Record";
    track.recordButton.classList.toggle("recording", isRecording);
    track.recordButton.disabled = busy && !isRecording;
    track.previewButton.disabled = busy;
    [track.muteButton, track.levelSlider, ...track.buttons].forEach(control => {
      control.disabled = recording !== null;
    });
  });
}
/* ---------- Sound ---------- */

// Create the audio system on the first click (browsers block sound until the user interacts).
function startAudio() {
  if (!audio) {
    audio = new AudioContext();
    newSpeaker();
  }
  audio.resume();
}
// Replace the speaker node. Disconnecting the old one silences anything still playing.
function newSpeaker() {
  if (speaker) speaker.disconnect();
  speaker = audio.createGain();
  speaker.connect(audio.destination);
}

// Play one hit of a track's sound at `time`, lasting at most `length` seconds.
// Used for live sound and for the WAV export. A tiny fade at each end prevents clicks.
function playHit(context, output, track, time, length) {
  length = Math.min(length, track.sound.duration);
  const volume = track.muted ? 0 : track.level * VOLUME;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = track.sound;
  source.connect(gain).connect(output);
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(volume, time + 0.008);
  gain.gain.setValueAtTime(volume, time + length - 0.008);
  gain.gain.linearRampToValueAtTime(0, time + length);
  source.start(time, 0, length);
}
/* ---------- Sound ---------- */

// Create the audio system on the first click (browsers block sound until the user interacts).
function startAudio() {
  if (!audio) {
    audio = new AudioContext();
    newSpeaker();
  }
  audio.resume();
}

// Replace the speaker node. Disconnecting the old one silences anything still playing.
function newSpeaker() {
  if (speaker) speaker.disconnect();
  speaker = audio.createGain();
  speaker.connect(audio.destination);
}

// Play one hit of a track's sound at `time`, lasting at most `length` seconds.
// Used for live sound and for the WAV export. A tiny fade at each end prevents clicks.
function playHit(context, output, track, time, length) {
  length = Math.min(length, track.sound.duration);
  const volume = track.muted ? 0 : track.level * VOLUME;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = track.sound;
  source.connect(gain).connect(output);
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(volume, time + 0.008);
  gain.gain.setValueAtTime(volume, time + length - 0.008);
  gain.gain.linearRampToValueAtTime(0, time + length);
  source.start(time, 0, length);
}

// Wrap raw sample values (-1 to 1) in an AudioBuffer.
function makeSound(data, rate) {
  const sound = new AudioBuffer({ length: data.length, sampleRate: rate });
  sound.copyToChannel(data, 0);
  return sound;
}

// Built-in demo sounds, made in code so they work without a microphone.
// "kick": a low tone that drops in pitch and fades. "shaker": a short burst of fading noise.
function makeDemoSound(type) {
  const rate = 44100;
  const data = new Float32Array(Math.ceil(rate * 0.22));
  let phase = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / rate;
    if (type === "shaker") {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 45);
    } else {
      phase += 2 * Math.PI * (55 + 110 * Math.exp(-t * 35)) / rate;
      data[i] = Math.sin(phase) * Math.exp(-t * 22);
    }
  }
  return makeSound(data, rate);
}/* ---------- The loop ---------- */

function startLoop() {
  startAudio();
  newSpeaker(); // also cuts off a Listen preview that is still playing
  playing = true;
  nextBeat = 0;
  nextTime = audio.currentTime + 0.05;
  bookBeats();
  timer = setInterval(bookBeats, 25);
  say("Playing together. Change beats, levels or mute states as you listen.");
  update();
}
// Runs every 25 ms and books every beat due in the next 0.1 s on the audio clock.
// The audio clock is exact, so the rhythm stays steady even when the page is busy.
function bookBeats() {
  if (nextTime < audio.currentTime) nextTime = audio.currentTime + 0.05; // fell behind: skip ahead
  while (nextTime < audio.currentTime + 0.1) {
    const beat = nextBeat;
    tracks.forEach(track => {
      if (isOn(track.buttons[beat])) playHit(audio, speaker, track, nextTime, beatLength());
    });
    // Light the beat up when it is heard, not when it is booked.
    setTimeout(() => { if (playing) highlight(beat); }, (nextTime - audio.currentTime) * 1000);
    nextBeat = (nextBeat + 1) % BEATS;
    nextTime += beatLength();
  }
}

function stopLoop() {
  playing = false;
  clearInterval(timer);
  newSpeaker(); // silence beats that were already booked
  highlight(-1);

   /* ---------- Playing the loop ---------- */

  // Runs every 25 ms and books any beats due in the next 0.1 s on the audio
  // clock. This keeps the rhythm steady even if the page is briefly busy.
  function schedule() {
    if (context.state !== "running") {
      stopPlayback();
      say("Paused. Press Play loop to continue.");
      return;
    }
    const seconds = beatLength();
    if (nextTime < context.currentTime) nextTime = context.currentTime + 0.03; // catch up after a delay
    while (nextTime < context.currentTime + LOOKAHEAD) {
      tracks.forEach(track => {
        if (isOn(track.buttons[nextBeat])) playSample(track.buffer, nextTime, seconds, context, track.output);
      });
      queue.push({ time: nextTime, beat: nextBeat });
      nextBeat = (nextBeat + 1) % STEPS;
      nextTime += seconds;
    }
  }// Highlight one beat on both tracks and on the timeline (-1 clears the highlight).
function highlight(beat) {
  $("#beat").textContent = beat < 0 ? "—" : "0" + (beat + 1);
  const rows = [...tracks.map(track => track.buttons), [...$("#timeline").children]];
  rows.forEach(row => row.forEach((element, i) => element.classList.toggle("current", i === beat)));
}


/* ---------- Recording ---------- */

// Record up to 3 seconds from the microphone into a track.
async function startRecording(track) {
  if (!window.isSecureContext || !window.MediaRecorder) {
    say("Recording is unavailable here. Open the published HTTPS page and allow microphone access. You can still try the demo sounds.");
    return;
  }
  startAudio();
  recording = { track, phase: "permission" };
  say(`Allow microphone access for ${track.name}.`);
  update();

  let stream;
  try {
    // Turn off voice processing so short taps and claps are not filtered out.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
  } catch (error) {
    recording = null;
    say(error.name === "NotAllowedError"
      ? "Microphone access is blocked. Allow it in your browser, or use the demo sounds."
      : "No microphone could be used. Connect one, or use the demo sounds.");
    update();
    return;
  }

  const chunks = [];
  recording.recorder = new MediaRecorder(stream);
  recording.recorder.ondataavailable = event => chunks.push(event.data);
  recording.recorder.onstop = () => saveRecording(chunks, stream);
  recording.recorder.start();
  recording.phase = "recording";
  recording.timer = setTimeout(finishRecording, 3000);
  showMicLevel(stream);
  say(`Recording ${track.name}. Make a short sound; press Finish or wait 3 seconds.`);
  update();
}// Stop recording. keep = false throws the take away (used when leaving the tab).
function finishRecording(keep = true) {
  if (recording?.phase !== "recording") return;
  clearTimeout(recording.timer);
  recording.keep = keep;
  recording.phase = "processing";
  recording.recorder.stop(); // saveRecording() runs once it has stopped
  if (keep) say("Processing your sound…");
  update();
}

// Turn the microphone off, then decode, trim and keep the new sound.
// The old sound is only replaced if this works.
async function saveRecording(chunks, stream) {
  stream.getTracks().forEach(micTrack => micTrack.stop());
  const { track, keep } = recording;
  if (keep) {
    try {
      const recorded = await audio.decodeAudioData(await new Blob(chunks).arrayBuffer());
      track.sound = trimSilence(recorded);
      track.label.textContent = `Your recording · ${track.sound.duration.toFixed(2)}s`;
      drawWave(track);
      say(`${track.name} saved. Listen to it, or play the shared loop.`);
    } catch (error) {
      say(error.message || "Recording failed. Please try again.");
    }
  }
  recording = null;
  update();
}// Cut silence from both ends, keeping 10 ms before and 20 ms after the sound,
// so a short tap starts right on the beat without losing its attack.
function trimSilence(sound) {
  const data = sound.getChannelData(0);
  const rate = sound.sampleRate;
  const first = data.findIndex(value => Math.abs(value) >= SILENCE);
  if (first === -1) throw new Error("No clear sound detected. Try recording closer to the microphone.");
  const last = data.findLastIndex(value => Math.abs(value) >= SILENCE);
  const start = Math.max(0, first - Math.round(rate * 0.01));
  const end = Math.min(data.length, last + Math.round(rate * 0.02));
  return makeSound(data.slice(start, end), rate);
}
