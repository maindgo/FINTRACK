import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Landmark,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { parseVoiceTransaction, AIInsightsApiError } from '../services/aiInsightsService';
import { createTransaction, deleteTransaction } from '../services/firestoreService';
import {
  ExpenseCategory,
  IncomeCategory,
  PaymentMethod,
  TransactionType,
} from '../types/finance';
import {
  EXPENSE_CATEGORIES,
  FIELD_LIMITS,
  INCOME_CATEGORIES,
  isCashPaymentMethod,
  PAYMENT_METHODS,
} from '../utils/constants';
import { formatCurrency, getCurrentTimeStr, getTodayStr } from '../utils/formatters';

interface VoiceTransactionModalProps {
  open: boolean;
  uid: string;
  onClose: () => void;
}

const MAX_RECORD_SECONDS = 15;

type MicPermissionStatus = 'checking' | 'granted' | 'prompt' | 'denied' | 'unsupported';

interface BrowserSpeechRecognitionEvent {
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [subIndex: number]: { transcript: string };
    };
  };
}

interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((ev: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognitionCtor(): (new () => BrowserSpeechRecognition) | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

function pickSupportedAudioMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return '';
}

function describeMicError(err: unknown): string {
  const name = (err as { name?: string })?.name || '';
  const msg = ((err as { message?: string })?.message || '').toLowerCase();
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || msg.includes('denied') || msg.includes('not allowed')) {
    return 'Microphone access was blocked. Click the lock/camera icon in your browser address bar, set Microphone to "Allow", then tap Retry — or use Live Dictation / Type below.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || msg.includes('not found')) {
    return 'No microphone was detected on this device. Please connect a microphone or type your transaction below.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Your microphone is currently in use by another app or tab. Close the other audio app and try again.';
  }
  if (name === 'SecurityError') {
    return 'Microphone requires a secure HTTPS connection. Please open FinTrack over HTTPS or type your entry below.';
  }
  return 'Could not start microphone recording. Check browser microphone permissions or type your phrase below.';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      if (commaIdx === -1) {
        reject(new Error('Failed to encode audio recording.'));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(new Error('Could not read recorded audio.'));
    reader.readAsDataURL(blob);
  });
}

export function VoiceTransactionModal({ open, uid, onClose }: VoiceTransactionModalProps) {
  const { currency } = useFinance();

  const [autoSave, setAutoSave] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  // Typed / Spoken fallback input
  const [textPhrase, setTextPhrase] = useState('');
  const [transcript, setTranscript] = useState('');

  // Parsed / Editable draft state
  const [hasDraft, setHasDraft] = useState(false);
  const [type, setType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<IncomeCategory | ExpenseCategory>(EXPENSE_CATEGORIES[0]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [date, setDate] = useState(getTodayStr());
  const [time, setTime] = useState(getCurrentTimeStr());
  const [description, setDescription] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);

  // Saved result confirmation
  const [savedRecord, setSavedRecord] = useState<{
    id: string;
    type: TransactionType;
    amount: number;
    title: string;
    category: string;
    paymentMethod: PaymentMethod;
    date: string;
  } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [micPermission, setMicPermission] = useState<MicPermissionStatus>('checking');
  const [dictating, setDictating] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const speechRecRef = useRef<BrowserSpeechRecognition | null>(null);
  const canceledOnCloseRef = useRef(false);

  const stopTracks = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {
        // ignore
      }
      speechRecRef.current = null;
    }
    mediaRecorderRef.current = null;
  };

  const resetAll = () => {
    setError('');
    setTranscript('');
    setTextPhrase('');
    setHasDraft(false);
    setSavedRecord(null);
    setRecordSeconds(0);
    setProcessing(false);
    setSavingDraft(false);
    setDictating(false);
  };

  useEffect(() => {
    if (!open) {
      canceledOnCloseRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      stopTracks();
      setRecording(false);
      return;
    }
    canceledOnCloseRef.current = false;
    resetAll();

    // Inspect microphone capability and permission status safely
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMicPermission('unsupported');
      return;
    }

    let permStatusObj: PermissionStatus | null = null;
    const handlePermChange = () => {
      if (permStatusObj) {
        setMicPermission(permStatusObj.state as MicPermissionStatus);
      }
    };

    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((status) => {
          if (canceledOnCloseRef.current) return;
          permStatusObj = status;
          setMicPermission(status.state as MicPermissionStatus);
          status.onchange = handlePermChange;
        })
        .catch(() => {
          if (!canceledOnCloseRef.current) {
            setMicPermission('prompt');
          }
        });
    } else {
      setMicPermission('prompt');
    }

    return () => {
      if (permStatusObj) {
        permStatusObj.onchange = null;
      }
    };
  }, [open]);

  useEffect(() => {
    return () => {
      canceledOnCloseRef.current = true;
      stopTracks();
    };
  }, []);

  if (!open) return null;

  const processParsedResult = async (resTransaction: {
    transcript: string;
    type: TransactionType;
    amount: number;
    title: string;
    category: IncomeCategory | ExpenseCategory;
    paymentMethod: PaymentMethod;
    date: string;
    time: string;
    description: string;
    missingAmountReason: string;
  }) => {
    setTranscript(resTransaction.transcript);
    setType(resTransaction.type);
    setAmount(resTransaction.amount > 0 ? String(resTransaction.amount) : '');
    setTitle(resTransaction.title);
    setCategory(resTransaction.category);
    setPaymentMethod(resTransaction.paymentMethod);
    setDate(resTransaction.date);
    setTime(resTransaction.time);
    setDescription(resTransaction.description);

    if (autoSave && resTransaction.amount > 0) {
      const createdId = await createTransaction(uid, {
        type: resTransaction.type,
        amount: resTransaction.amount,
        title: resTransaction.title,
        category: resTransaction.category,
        date: resTransaction.date,
        time: resTransaction.time,
        paymentMethod: resTransaction.paymentMethod,
        description: resTransaction.description || 'Added via Voice AI',
        notes: resTransaction.transcript ? `Voice: "${resTransaction.transcript}"` : '',
        receiptName: '',
        receiptDataUrl: '',
        recurringId: '',
      });
      setSavedRecord({
        id: createdId,
        type: resTransaction.type,
        amount: resTransaction.amount,
        title: resTransaction.title,
        category: resTransaction.category,
        paymentMethod: resTransaction.paymentMethod,
        date: resTransaction.date,
      });
      setHasDraft(false);
    } else {
      setHasDraft(true);
      if (resTransaction.amount <= 0 && resTransaction.missingAmountReason) {
        setError(resTransaction.missingAmountReason);
      }
    }
  };

  const submitVoicePayload = async (payload: {
    audioBase64?: string;
    mimeType?: string;
    transcriptText?: string;
  }) => {
    setProcessing(true);
    setError('');
    setSavedRecord(null);
    try {
      const res = await parseVoiceTransaction({
        ...payload,
        localDate: getTodayStr(),
        localTime: getCurrentTimeStr(),
      });
      if (canceledOnCloseRef.current) return;
      await processParsedResult(res.transaction);
    } catch (err: unknown) {
      if (canceledOnCloseRef.current) return;
      if (err instanceof AIInsightsApiError) {
        setError(err.message);
      } else {
        setError((err as Error)?.message || 'Failed to process voice entry.');
      }
    } finally {
      if (!canceledOnCloseRef.current) {
        setProcessing(false);
      }
    }
  };

  const requestMicPermissionOnly = async () => {
    setError('');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMicPermission('unsupported');
      setError('Microphone recording is not supported in this browser. Type your entry below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicPermission('granted');
    } catch (err) {
      setMicPermission('denied');
      setError(describeMicError(err));
    }
  };

  const startLiveDictation = () => {
    const SpeechRec = getSpeechRecognitionCtor();
    if (!SpeechRec || recording || processing) return;
    setError('');
    setSavedRecord(null);
    setHasDraft(false);

    try {
      const rec = new SpeechRec();
      rec.lang = 'en-IN';
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.continuous = false;
      let latestTranscript = '';

      rec.onresult = (ev) => {
        const parts: string[] = [];
        for (let i = 0; i < ev.results.length; i += 1) {
          const item = ev.results[i]?.[0]?.transcript;
          if (item) parts.push(item);
        }
        latestTranscript = parts.join(' ').trim();
        if (latestTranscript) {
          setTextPhrase(latestTranscript);
        }
      };

      rec.onerror = (ev) => {
        setDictating(false);
        speechRecRef.current = null;
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
          setMicPermission('denied');
          setError(
            'Microphone access was blocked by the browser. Click the site lock icon in the address bar to allow Microphone, or type your transaction below.'
          );
        } else if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
          setError('Live speech recognition stopped. You can retry microphone or type your phrase below.');
        }
      };

      rec.onend = () => {
        setDictating(false);
        speechRecRef.current = null;
        if (latestTranscript && !canceledOnCloseRef.current) {
          void submitVoicePayload({ transcriptText: latestTranscript });
        }
      };

      speechRecRef.current = rec;
      setDictating(true);
      rec.start();
    } catch (err) {
      setDictating(false);
      setError(describeMicError(err));
    }
  };

  const stopLiveDictation = () => {
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {
        // ignore
      }
    }
    setDictating(false);
  };

  const startRecording = async () => {
    setError('');
    setSavedRecord(null);
    setHasDraft(false);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMicPermission('unsupported');
      setError('Microphone recording is not supported in this browser. Type your expense phrase below instead.');
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      if (getSpeechRecognitionCtor()) {
        startLiveDictation();
        return;
      }
      setError('Audio recording is unavailable on this browser. Type your expense phrase below instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermission('granted');
      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        setError('No active audio input track was found on your device.');
        return;
      }

      streamRef.current = stream;
      chunksRef.current = [];

      const preferredMime = pickSupportedAudioMime();
      let recorder: MediaRecorder;
      try {
        recorder = preferredMime
          ? new MediaRecorder(stream, { mimeType: preferredMime })
          : new MediaRecorder(stream);
      } catch {
        recorder = new MediaRecorder(stream);
      }

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const mimeUsed = recorder.mimeType || preferredMime || 'audio/webm';
        const audioBlob = new Blob(chunksRef.current, { type: mimeUsed });
        stopTracks();
        setRecording(false);

        if (canceledOnCloseRef.current) return;
        if (audioBlob.size < 400) {
          setError('Recording was too short. Please hold or speak for at least 1–2 seconds.');
          return;
        }

        try {
          const audioBase64 = await blobToBase64(audioBlob);
          await submitVoicePayload({ audioBase64, mimeType: mimeUsed });
        } catch (err) {
          setError((err as Error)?.message || 'Unable to process recorded audio.');
        }
      };

      recorder.start();
      setRecording(true);
      setRecordSeconds(0);

      let elapsed = 0;
      timerRef.current = window.setInterval(() => {
        elapsed += 1;
        setRecordSeconds(elapsed);
        if (elapsed >= MAX_RECORD_SECONDS) {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
          }
        }
      }, 1000);
    } catch (err) {
      stopTracks();
      setRecording(false);
      const errName = (err as { name?: string })?.name || '';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        setMicPermission('denied');
      }
      setError(describeMicError(err));
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = textPhrase.trim();
    if (!cleaned || processing || recording) return;
    await submitVoicePayload({ transcriptText: cleaned });
  };

  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmt = Number(amount);
    if (!Number.isFinite(parsedAmt) || parsedAmt <= 0) {
      setError('Please enter a valid positive amount.');
      return;
    }
    if (!title.trim()) {
      setError('Please enter a title.');
      return;
    }

    setSavingDraft(true);
    setError('');
    try {
      const createdId = await createTransaction(uid, {
        type,
        amount: parsedAmt,
        title: title.trim(),
        category,
        date,
        time,
        paymentMethod,
        description: description.trim() || 'Added via Voice AI',
        notes: transcript ? `Voice: "${transcript}"` : '',
        receiptName: '',
        receiptDataUrl: '',
        recurringId: '',
      });
      setSavedRecord({
        id: createdId,
        type,
        amount: parsedAmt,
        title: title.trim(),
        category,
        paymentMethod,
        date,
      });
      setHasDraft(false);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to save transaction.');
    } finally {
      setSavingDraft(false);
    }
  };

  const handleUndoSaved = async () => {
    if (!savedRecord || undoing) return;
    setUndoing(true);
    try {
      await deleteTransaction(uid, savedRecord.id);
      setSavedRecord(null);
      setHasDraft(true);
    } catch (err) {
      setError((err as Error)?.message || 'Could not undo entry.');
    } finally {
      setUndoing(false);
    }
  };

  const categories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-slate-900 px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Voice AI Transaction Entry
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Speak naturally in English or Hindi to auto-record income or expenses
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Voice AI"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Auto-Save Toggle */}
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-white">
                Auto-add directly to record
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {autoSave
                  ? 'Saves immediately after speaking (with Undo option)'
                  : 'Shows parsed details for review before saving'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoSave}
              onClick={() => setAutoSave((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                autoSave ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoSave ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Microphone Permission Banner */}
          {!savedRecord && !hasDraft && (
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 text-xs min-w-0">
                {micPermission === 'granted' ? (
                  <>
                    <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="font-medium text-emerald-700 dark:text-emerald-300">
                      Microphone permission enabled
                    </span>
                  </>
                ) : micPermission === 'denied' ? (
                  <>
                    <MicOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="text-amber-800 dark:text-amber-300">
                      Microphone blocked — click Allow in browser site settings
                    </span>
                  </>
                ) : micPermission === 'unsupported' ? (
                  <>
                    <MicOff className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-slate-600 dark:text-slate-400">
                      Use quick phrase input below
                    </span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="text-slate-700 dark:text-slate-300">
                      Enable microphone access for hands-free Voice AI
                    </span>
                  </>
                )}
              </div>

              {(micPermission === 'prompt' || micPermission === 'denied') && (
                <button
                  type="button"
                  onClick={requestMicPermissionOnly}
                  className="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 whitespace-nowrap shrink-0"
                >
                  {micPermission === 'denied' ? 'Retry Access' : 'Allow Mic'}
                </button>
              )}
            </div>
          )}

          {/* Microphone Capture Area */}
          {!savedRecord && !hasDraft && (
            <div className="flex flex-col items-center text-center py-3 space-y-4">
              <button
                type="button"
                disabled={processing || dictating}
                onClick={recording ? stopRecording : startRecording}
                className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-md disabled:opacity-50 ${
                  recording
                    ? 'bg-red-600 text-white hover:bg-red-700 ring-4 ring-red-500/25 animate-pulse'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700 ring-4 ring-emerald-500/15'
                }`}
              >
                {processing ? (
                  <Loader2 className="w-8 h-8 animate-spin" />
                ) : recording ? (
                  <Square className="w-7 h-7 fill-current" />
                ) : (
                  <Mic className="w-8 h-8" />
                )}
              </button>

              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  {processing
                    ? 'Understanding your entry...'
                    : recording
                    ? `Listening... ${recordSeconds}s / ${MAX_RECORD_SECONDS}s (Tap to stop)`
                    : dictating
                    ? 'Dictating live... Speak clearly'
                    : 'Tap microphone & speak your transaction'}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
                  Example: &ldquo;Paid ₹240 for lunch by UPI&rdquo; or &ldquo;Spent 150 cash for auto&rdquo; or &ldquo;Received 12000 freelancing by bank transfer&rdquo;
                </p>
              </div>

              {getSpeechRecognitionCtor() && !recording && !processing && (
                <button
                  type="button"
                  onClick={dictating ? stopLiveDictation : startLiveDictation}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    dictating
                      ? 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>{dictating ? 'Stop Live Dictation' : 'Use Browser Live Dictation'}</span>
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Quick Type / Voice Fallback */}
          {!savedRecord && !hasDraft && (
            <form onSubmit={handleTextSubmit} className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Or type / dictate a quick phrase directly
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={300}
                  value={textPhrase}
                  onChange={(e) => setTextPhrase(e.target.value)}
                  placeholder="e.g., Paid 450 for groceries via UPI today"
                  disabled={processing || recording}
                  className="flex-1 min-w-0 px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
                />
                <button
                  type="submit"
                  disabled={!textPhrase.trim() || processing || recording}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Parse</span>
                </button>
              </div>
            </form>
          )}

          {/* Auto-Saved Confirmation Card */}
          {savedRecord && (
            <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <span className="text-sm font-bold">
                    {savedRecord.type === 'income' ? 'Income Recorded' : 'Expense Recorded'}
                  </span>
                </div>
                <span className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {savedRecord.type === 'income' ? '+' : '-'}
                  {formatCurrency(savedRecord.amount, currency)}
                </span>
              </div>

              {transcript && (
                <div className="text-xs text-slate-600 dark:text-slate-300 italic bg-white/70 dark:bg-slate-900/60 px-3 py-2 rounded-lg border border-emerald-200/70 dark:border-emerald-900">
                  &ldquo;{transcript}&rdquo;
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Title:</span>{' '}
                  <span className="font-semibold text-slate-900 dark:text-white">{savedRecord.title}</span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Category:</span>{' '}
                  <span className="font-semibold text-slate-900 dark:text-white">{savedRecord.category}</span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Method:</span>{' '}
                  <span className="font-semibold text-slate-900 dark:text-white">{savedRecord.paymentMethod}</span>
                </div>
                <div className="flex items-center gap-1">
                  {isCashPaymentMethod(savedRecord.paymentMethod) ? (
                    <Wallet className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  ) : (
                    <Landmark className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  )}
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {isCashPaymentMethod(savedRecord.paymentMethod)
                      ? savedRecord.type === 'income'
                        ? 'Added to Cash'
                        : 'Deducted from Cash'
                      : savedRecord.type === 'income'
                      ? 'Added to Bank / UPI'
                      : 'Deducted from Bank / UPI'}
                  </span>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-emerald-200 dark:border-emerald-900">
                <button
                  type="button"
                  disabled={undoing}
                  onClick={handleUndoSaved}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {undoing ? 'Undoing...' : 'Undo & Edit'}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetAll}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Record Another
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold hover:opacity-90"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Review / Edit Draft Form */}
          {hasDraft && !savedRecord && (
            <form onSubmit={handleSaveDraft} className="space-y-3.5">
              {transcript && (
                <div className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3 py-2 rounded-lg">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">Heard:</span> &ldquo;{transcript}&rdquo;
                </div>
              )}

              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setType('income');
                    setCategory(INCOME_CATEGORIES[0]);
                  }}
                  className={`py-1.5 text-xs font-semibold rounded-md ${
                    type === 'income'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Income
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setType('expense');
                    setCategory(EXPENSE_CATEGORIES[0]);
                  }}
                  className={`py-1.5 text-xs font-semibold rounded-md ${
                    type === 'expense'
                      ? 'bg-slate-900 dark:bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Expense
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Amount *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Title *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={FIELD_LIMITS.TITLE_MAX}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Category *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as IncomeCategory | ExpenseCategory)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Payment Method *
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Time
                  </label>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={resetAll}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Retry Voice
                </button>
                <button
                  type="submit"
                  disabled={savingDraft}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingDraft ? 'Saving...' : 'Save Transaction'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
