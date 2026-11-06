package com.getcapacitor.community.tts;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.PlaybackParams;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public class TextToSpeech implements android.speech.tts.TextToSpeech.OnInitListener {

    public static final String LOG_TAG = "TextToSpeech";

    private Context context;
    private android.speech.tts.TextToSpeech tts = null;
    private int initializationStatus;
    private JSObject[] supportedVoices = null;
    private Map<String, SpeakResultCallback> requests = new HashMap();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private MediaPlayer mediaPlayer;
    private File pendingFile;
    private String pendingText = "";
    private String pendingUtteranceId = "";
    private float pendingPitch = 1f;
    private float pendingRate = 1f;
    private float pendingVolume = 1f;
    private int pendingQueue = android.speech.tts.TextToSpeech.QUEUE_FLUSH;
    private boolean awaitingFile = false;
    private boolean usedFileFallback = false;
    private int playbackGeneration = 0;

    TextToSpeech(Context context) {
        this.context = context;
        try {
            tts = new android.speech.tts.TextToSpeech(context, this);
            tts.setOnUtteranceProgressListener(
                new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {}

                    @Override
                    public void onDone(String utteranceId) {
                        if (awaitingFile && utteranceId != null && utteranceId.equals(pendingUtteranceId)) {
                            awaitingFile = false;
                            final int generation = playbackGeneration;
                            mainHandler.post(() -> playSynthesized(utteranceId, generation));
                            return;
                        }
                        if (awaitingFile) return;
                        SpeakResultCallback callback = requests.get(utteranceId);
                        if (callback != null) {
                            callback.onDone();
                            requests.remove(utteranceId);
                        }
                    }

                    @Override
                    public void onError(String utteranceId) {
                        if (awaitingFile && utteranceId != null && utteranceId.equals(pendingUtteranceId)) {
                            awaitingFile = false;
                            final int generation = playbackGeneration;
                            mainHandler.post(() -> fallbackSpeak(utteranceId, generation));
                            return;
                        }
                        if (awaitingFile) return;
                        SpeakResultCallback callback = requests.get(utteranceId);
                        if (callback != null) {
                            callback.onError();
                            requests.remove(utteranceId);
                        }
                    }

                    @Override
                    public void onRangeStart(String utteranceId, int start, int end, int frame) {
                        SpeakResultCallback callback = requests.get(utteranceId);
                        if (callback != null) {
                            callback.onRangeStart(start, end);
                        }
                    }
                }
            );
        } catch (Exception ex) {
            Log.d(LOG_TAG, ex.getLocalizedMessage());
        }
    }

    @Override
    public void onInit(int status) {
        this.initializationStatus = status;
    }

    public void speak(
        String text,
        String lang,
        float rate,
        float pitch,
        float volume,
        int voice,
        String callbackId,
        SpeakResultCallback resultCallback
    ) {
        speak(text, lang, rate, pitch, volume, voice, callbackId, resultCallback, android.speech.tts.TextToSpeech.QUEUE_FLUSH);
    }

    public void speak(
        String text,
        String lang,
        float rate,
        float pitch,
        float volume,
        int voice,
        String callbackId,
        SpeakResultCallback resultCallback,
        int queueStrategy
    ) {
        if (queueStrategy != android.speech.tts.TextToSpeech.QUEUE_ADD) {
            stop();
        }
        requests.put(callbackId, resultCallback);

        Locale locale = Locale.forLanguageTag(lang);
        tts.setLanguage(locale);
        if (voice >= 0) {
            ArrayList<Voice> supportedVoices = getSupportedVoicesOrdered();
            if (voice < supportedVoices.size()) {
                tts.setVoice(supportedVoices.get(voice));
            }
        }

        pendingText = text;
        pendingUtteranceId = callbackId;
        pendingPitch = clamp(pitch, 0.5f, 2f);
        pendingRate = clamp(rate, 0.5f, 2f);
        pendingVolume = clamp(volume, 0f, 1f);
        pendingQueue = queueStrategy;
        usedFileFallback = false;
        playbackGeneration++;
        final int generation = playbackGeneration;

        Bundle ttsParams = new Bundle();
        ttsParams.putSerializable(android.speech.tts.TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, callbackId);
        ttsParams.putSerializable(android.speech.tts.TextToSpeech.Engine.KEY_PARAM_VOLUME, pendingVolume);
        // Many engines ignore setPitch, and setVoice resets it. Synthesize flat, then pitch-shift on playback.
        tts.setSpeechRate(1f);
        tts.setPitch(1f);

        File file = new File(context.getCacheDir(), "dealer-tts.wav");
        if (file.exists()) file.delete();
        pendingFile = file;
        awaitingFile = true;
        int code = tts.synthesizeToFile(text, ttsParams, file, callbackId);
        if (code != android.speech.tts.TextToSpeech.SUCCESS) {
            awaitingFile = false;
            fallbackSpeak(callbackId, generation);
        }
    }

    private void playSynthesized(String utteranceId, int generation) {
        if (generation != playbackGeneration) return;
        SpeakResultCallback callback = requests.get(utteranceId);
        File file = pendingFile;
        if (callback == null || file == null || !file.exists()) {
            if (callback != null) {
                callback.onError();
                requests.remove(utteranceId);
            }
            return;
        }
        releasePlayer();
        try {
            MediaPlayer player = new MediaPlayer();
            mediaPlayer = player;
            player.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            );
            player.setDataSource(file.getAbsolutePath());
            player.setOnPreparedListener(prepared -> {
                if (generation != playbackGeneration || mediaPlayer != prepared) {
                    prepared.release();
                    return;
                }
                prepared.setVolume(pendingVolume, pendingVolume);
                prepared.start();
                try {
                    PlaybackParams params = prepared.getPlaybackParams();
                    params.setPitch(pendingPitch);
                    params.setSpeed(pendingRate);
                    prepared.setPlaybackParams(params);
                } catch (Exception ex) {
                    Log.d(LOG_TAG, "playback pitch failed");
                }
            });
            player.setOnCompletionListener(done -> {
                if (mediaPlayer == done) mediaPlayer = null;
                done.release();
                file.delete();
                SpeakResultCallback doneCallback = requests.get(utteranceId);
                if (doneCallback != null) {
                    doneCallback.onDone();
                    requests.remove(utteranceId);
                }
            });
            player.setOnErrorListener((errored, what, extra) -> {
                if (mediaPlayer == errored) mediaPlayer = null;
                errored.release();
                file.delete();
                fallbackSpeak(utteranceId, generation);
                return true;
            });
            player.prepareAsync();
        } catch (Exception ex) {
            Log.d(LOG_TAG, ex.getLocalizedMessage());
            fallbackSpeak(utteranceId, generation);
        }
    }

    private void fallbackSpeak(String utteranceId, int generation) {
        if (generation != playbackGeneration) return;
        SpeakResultCallback callback = requests.get(utteranceId);
        if (callback == null) return;
        if (usedFileFallback) {
            callback.onError();
            requests.remove(utteranceId);
            return;
        }
        usedFileFallback = true;
        awaitingFile = false;
        Bundle ttsParams = new Bundle();
        ttsParams.putSerializable(android.speech.tts.TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId);
        ttsParams.putSerializable(android.speech.tts.TextToSpeech.Engine.KEY_PARAM_VOLUME, pendingVolume);
        tts.setSpeechRate(pendingRate);
        tts.setPitch(pendingPitch);
        tts.speak(pendingText, pendingQueue, ttsParams, utteranceId);
    }

    private float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }

    private void releasePlayer() {
        if (mediaPlayer == null) return;
        try {
            mediaPlayer.release();
        } catch (Exception ignored) {}
        mediaPlayer = null;
    }

    public void stop() {
        playbackGeneration++;
        awaitingFile = false;
        if (tts != null) tts.stop();
        releasePlayer();
        requests.clear();
        if (pendingFile != null && pendingFile.exists()) pendingFile.delete();
    }

    public JSArray getSupportedLanguages() {
        ArrayList<String> languages = new ArrayList<>();
        Set<Locale> supportedLocales = tts.getAvailableLanguages();
        for (Locale supportedLocale : supportedLocales) {
            String tag = supportedLocale.toLanguageTag();
            languages.add(tag);
        }
        JSArray result = JSArray.from(languages.toArray());
        return result;
    }

    /**
     * @return Ordered list of voices. The order is guaranteed to remain the same as long as the voices in tts.getVoices() do not change.
     */
    public ArrayList<Voice> getSupportedVoicesOrdered() {
        Set<Voice> supportedVoices = tts.getVoices();
        ArrayList<Voice> orderedVoices = new ArrayList<Voice>();
        for (Voice supportedVoice : supportedVoices) {
            orderedVoices.add(supportedVoice);
        }

        //voice.getName() is guaranteed to be unique, so will be used for sorting.
        Collections.sort(orderedVoices, (v1, v2) -> v1.getName().compareTo(v2.getName()));

        return orderedVoices;
    }

    public JSArray getSupportedVoices() {
        ArrayList<JSObject> voices = new ArrayList<>();
        ArrayList<Voice> supportedVoices = getSupportedVoicesOrdered();
        for (Voice supportedVoice : supportedVoices) {
            JSObject obj = this.convertVoiceToJSObject(supportedVoice);
            voices.add(obj);
        }
        JSArray result = JSArray.from(voices.toArray());
        return result;
    }

    public void openInstall() {
        PackageManager packageManager = context.getPackageManager();
        Intent installIntent = new Intent();
        installIntent.setAction(android.speech.tts.TextToSpeech.Engine.ACTION_CHECK_TTS_DATA);

        ResolveInfo resolveInfo = packageManager.resolveActivity(installIntent, PackageManager.MATCH_DEFAULT_ONLY);

        if (resolveInfo != null) {
            installIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(installIntent);
        }
    }

    public boolean isAvailable() {
        if (tts != null && initializationStatus == android.speech.tts.TextToSpeech.SUCCESS) {
            return true;
        }
        return false;
    }

    public boolean isLanguageSupported(String lang) {
        Locale locale = Locale.forLanguageTag(lang);
        int result = tts.isLanguageAvailable(locale);
        return result == tts.LANG_AVAILABLE || result == tts.LANG_COUNTRY_AVAILABLE || result == tts.LANG_COUNTRY_VAR_AVAILABLE;
    }

    public void onDestroy() {
        releasePlayer();
        if (tts == null) {
            return;
        }
        tts.stop();
        tts.shutdown();
    }

    private JSObject convertVoiceToJSObject(Voice voice) {
        Locale locale = voice.getLocale();
        JSObject obj = new JSObject();
        obj.put("voiceURI", voice.getName());
        obj.put("name", locale.getDisplayLanguage() + " " + locale.getDisplayCountry());
        obj.put("lang", locale.toLanguageTag());
        obj.put("localService", !voice.isNetworkConnectionRequired());
        obj.put("default", false);
        return obj;
    }
}
