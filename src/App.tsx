import React, { useState, useMemo, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Download, Loader2, Volume2, User, UserRound, Sparkles, History, X, Search, Trash2, Play } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { saveHistory, getAllHistory, deleteHistoryItem, type HistoryItem, type SuggestionRecord } from './lib/db';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function createWavBuffer(pcmData: Int16Array, sampleRate: number) {
  const numChannels = 1;
  const blockAlign = numChannels * 2;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < pcmData.length; i++, offset += 2) {
    view.setInt16(offset, pcmData[i], true);
  }

  return buffer;
}

function pcmToWav(pcmBase64: string, sampleRate: number = 24000): string {
  const binaryString = atob(pcmBase64);
  const pcm16 = new Int16Array(binaryString.length / 2);
  for (let i = 0; i < pcm16.length; i++) {
    pcm16[i] = binaryString.charCodeAt(i * 2) | (binaryString.charCodeAt(i * 2 + 1) << 8);
  }
  
  const wavArrayBuffer = createWavBuffer(pcm16, sampleRate);
  const blob = new Blob([wavArrayBuffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

interface Suggestion {
  type: 'synonym' | 'structure' | 'idiom';
  original: string;
  replacement: string;
  explanation: string;
}

interface HistoryCardProps {
  item: HistoryItem;
  onDelete: () => void;
}

const HistoryCard: React.FC<HistoryCardProps> = ({ item, onDelete }) => {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const handleTogglePlay = () => {
    if (!audioUrl) {
      setAudioUrl(pcmToWav(item.audioBase64, 24000));
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-indigo-100 hover:shadow-md transition-all">
      <div className="flex justify-between items-start mb-2">
         <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded uppercase tracking-wider">
           {new Date(item.createdAt).toLocaleString('vi-VN')}
         </span>
         <button onClick={onDelete} className="text-slate-300 hover:text-red-500 transition-colors p-1" title="Xóa lịch sử">
            <Trash2 className="w-4 h-4" />
         </button>
      </div>
      <p className="text-sm text-slate-700 line-clamp-3 mb-3 leading-relaxed">{item.text}</p>
      
      {item.appliedSuggestions && item.appliedSuggestions.length > 0 && (
         <div className="mb-3 space-y-1">
            <p className="text-xs font-bold text-indigo-600 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              Đã áp dụng {item.appliedSuggestions.length} gợi ý nâng cao
            </p>
            <div className="flex flex-col gap-1">
              {item.appliedSuggestions.slice(0, 3).map((s, i) => (
                <div key={i} className="text-[11px] text-slate-500 bg-slate-50 px-2 py-1.5 rounded-lg border border-slate-100 flex items-center gap-2">
                  <span className="line-through decoration-slate-300 shrink-0">{s.original}</span> 
                  <span className="text-slate-300 shrink-0">→</span> 
                  <span className="font-bold text-indigo-600 truncate">{s.replacement}</span>
                </div>
              ))}
              {item.appliedSuggestions.length > 3 && (
                <div className="text-[10px] text-slate-400 font-medium pl-1">
                  + {item.appliedSuggestions.length - 3} gợi ý khác...
                </div>
              )}
            </div>
         </div>
      )}

      <div className="flex items-center gap-3 pt-2">
         <span className={cn(
            "text-[11px] font-bold px-2 py-1 rounded-md shrink-0",
            item.voice === 'Male' ? "bg-blue-50 text-blue-700 border border-blue-100" : "bg-rose-50 text-rose-700 border border-rose-100"
         )}>
           Giọng {item.voice === 'Male' ? 'Nam' : 'Nữ'}
         </span>
         
         <div className="flex-1 flex justify-end">
           {audioUrl ? (
             <audio src={audioUrl} controls className="h-8 w-full max-w-[200px]" autoPlay />
           ) : (
             <button onClick={handleTogglePlay} className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-md transition-colors border border-slate-200">
               <Play className="w-3 h-3" />
               Phát lại
             </button>
           )}
         </div>
      </div>
    </div>
  );
}

export default function App() {
  const [text, setText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeVoice, setActiveVoice] = useState<'Male' | 'Female' | null>(null);
  
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [appliedSuggestions, setAppliedSuggestions] = useState<SuggestionRecord[]>([]);

  // History State
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);

  const wordCount = useMemo(() => {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
  }, [text]);

  const isValidLength = wordCount >= 1 && wordCount <= 500;

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, audioUrl]);

  useEffect(() => {
    if (showHistory) {
      loadHistory();
    }
  }, [showHistory]);

  const loadHistory = async () => {
    try {
      const items = await getAllHistory();
      setHistoryList(items);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteHistory = async (id: string) => {
    if (confirm('Bạn có chắc chắn muốn xóa mục lịch sử này?')) {
      await deleteHistoryItem(id);
      loadHistory();
    }
  };

  const filteredHistory = historyList.filter(item => 
    item.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const changeSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
  };

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    
    setIsAnalyzing(true);
    setError(null);
    setSuggestions([]);

    try {
      const prompt = `Phân tích văn bản tiếng Anh sau và đề xuất 3-5 cách cải thiện để đạt điểm cao hơn trong phần thi nói Aptis/IELTS. Tập trung vào việc thay thế các từ vựng cơ bản bằng từ vựng nâng cao (synonym), thay thế cấu trúc câu đơn giản bằng cấu trúc phức tạp hơn (structure), hoặc thêm phrasal verb/idiom phù hợp ngữ cảnh.
Chỉ trả về JSON hợp lệ theo cấu trúc sau, không có format markdown:
{
  "suggestions": [
     {
       "type": "synonym" | "structure" | "idiom",
       "original": "Đoạn văn bản gốc chính xác CÓ THỂ TÌM THẤY TRONG BÀI để thay thế",
       "replacement": "Đoạn văn bản nâng cao thay thế",
       "explanation": "Giải thích ngắn gọn tiếng Việt"
     }
  ]
}

Văn bản: "${text}"`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          temperature: 0.7
        }
      });

      const resText = response.text || "{}";
      const data = JSON.parse(resText);
      if (data.suggestions && Array.isArray(data.suggestions)) {
        const validSuggestions = data.suggestions.filter((s: Suggestion) => text.includes(s.original));
        setSuggestions(validSuggestions);
        if (validSuggestions.length === 0) {
          setError("Các gợi ý không khớp chính xác với nội dung hiện tại, vui lòng thử lại.");
        }
      } else {
        setError("Không thể phân tích dữ liệu lúc này.");
      }
    } catch (err: any) {
      console.error(err);
      setError("Lỗi khi phân tích nội dung: " + (err?.message || 'Unknown error'));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const applySuggestion = (original: string, replacement: string, index: number) => {
    setText((prev) => prev.replace(original, replacement));
    const suggested = suggestions[index];
    setAppliedSuggestions(prev => [...prev, suggested]);
    setSuggestions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async (voice: 'Male' | 'Female') => {
    if (!text.trim()) {
      setError('Vui lòng nhập nội dung bài nói.');
      return;
    }
    if (!isValidLength) {
      setError(`Vui lòng nhập từ 1 đến 500 từ. Hiện tại: ${wordCount} từ.`);
      return;
    }

    setIsGenerating(true);
    setActiveVoice(voice);
    setError(null);
    setAudioUrl(null);

    const voiceName = voice === 'Male' ? 'Charon' : 'Kore';

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const url = pcmToWav(base64Audio, 24000);
        setAudioUrl(url);
        
        try {
          await saveHistory({
            id: Date.now().toString(),
            createdAt: Date.now(),
            text: text,
            voice: voice,
            audioBase64: base64Audio,
            appliedSuggestions: appliedSuggestions
          });
        } catch(e) {
          console.error("Failed to save history", e);
        }
      } else {
        setError('Không tạo được audio. Vui lòng thử lại.');
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Có lỗi xảy ra khi gọi API.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (audioUrl) {
      const a = document.createElement('a');
      a.href = audioUrl;
      a.download = `aptis-speaking-${activeVoice?.toLowerCase()}-${Date.now()}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const renderAudioPlayer = (voice: 'Male' | 'Female') => {
    if (audioUrl && activeVoice === voice && !isGenerating) {
      return (
        <div className="flex flex-col w-full gap-3 animate-in fade-in zoom-in-95 duration-300">
          <audio ref={audioRef} src={audioUrl} controls className="h-10 w-full rounded-lg" autoPlay />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 bg-white/60 p-1 rounded-lg border border-slate-200/60 shadow-sm backdrop-blur-sm">
              {[0.75, 1, 1.25].map(speed => (
                <button
                  key={speed}
                  onClick={() => changeSpeed(speed)}
                  className={cn(
                    "text-xs font-bold px-2 py-1 rounded-md transition-all h-7 flex items-center justify-center",
                    playbackSpeed === speed 
                      ? "bg-white text-indigo-700 shadow border border-slate-200" 
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/50"
                  )}
                >
                  {speed}x
                </button>
              ))}
            </div>
            <button
              onClick={handleDownload}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 bg-white border text-xs font-bold rounded-lg transition-colors shadow-sm h-9",
                voice === 'Male' 
                  ? "border-blue-200 text-blue-700 hover:bg-blue-50 focus:ring-2 focus:ring-blue-100"
                  : "border-rose-200 text-rose-700 hover:bg-rose-50 focus:ring-2 focus:ring-rose-100"
              )}
            >
              <Download className="w-4 h-4" />
              Lưu Audio
            </button>
          </div>
        </div>
      );
    }

    return (
      <span className="text-sm italic text-slate-400 font-medium">
        {isGenerating && activeVoice === voice ? 'Đang tạo...' : 'Chưa được tạo...'}
      </span>
    );
  };

  return (
    <div className="bg-slate-50 w-full min-h-screen flex flex-col items-center justify-center font-sans py-12 px-4">
      {/* History Slide Panel */}
      {showHistory && (
        <div className="fixed inset-0 z-50 bg-slate-900/20 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
          <div className="w-full max-w-sm sm:max-w-md bg-slate-50 h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300 border-l border-slate-200">
            <div className="flex items-center justify-between p-4 bg-white border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-600" />
                Lịch sử luyện tập
              </h2>
              <button onClick={() => setShowHistory(false)} className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-white border-b border-slate-200">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Tìm theo nội dung bài nói..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {filteredHistory.map(item => (
                 <HistoryCard key={item.id} item={item} onDelete={() => handleDeleteHistory(item.id)} />
              ))}
              {filteredHistory.length === 0 && (
                <div className="text-center text-slate-500 text-sm mt-8 flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-200 rounded-xl bg-white">
                   <History className="w-8 h-8 text-slate-300 mb-3" />
                   Không có lịch sử nào phù hợp. Bắt đầu luyện tập để lưu lại!
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-4xl bg-white p-6 sm:p-12 rounded-3xl shadow-xl border border-slate-200 relative">
        <button 
           onClick={() => setShowHistory(true)}
           className="absolute top-6 sm:top-12 right-6 sm:right-12 flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 px-3 py-2 rounded-xl transition-all border border-slate-200 shadow-sm"
        >
           <History className="w-4 h-4" />
           <span className="hidden sm:inline">Lịch sử</span>
        </button>

        <header className="mb-8 text-center pr-12 sm:pr-0">
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight mb-2">
            Trợ lý hỗ trợ bài thi Aptis kĩ năng nói
          </h1>
          <p className="text-slate-500 font-medium">
            Chuyển đổi văn bản thành giọng nói chuẩn bản ngữ để luyện tập phát âm và ngữ điệu.
          </p>
        </header>

        <div className="space-y-6">
          <div>
            <div className="flex justify-between items-center mb-3">
              <label className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
                Nội dung bài nói
              </label>
              <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
                <button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing || !text.trim()}
                  className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 hover:border-indigo-200 px-3 py-1.5 rounded-lg transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {isAnalyzing ? "Đang phân tích..." : "Nâng cao từ vựng"}
                </button>
                <span className={cn(
                  "text-xs font-mono px-2 py-1.5 rounded-lg transition-colors border",
                  wordCount > 500 ? "text-red-700 bg-red-50 border-red-200" : "text-slate-500 bg-slate-50 border-slate-200"
                )}>
                  {wordCount} / 500 từ
                </span>
              </div>
            </div>
            <textarea
              className={cn(
                "w-full h-64 p-5 bg-slate-50 border rounded-2xl text-slate-700 border-slate-200 text-lg leading-relaxed focus:outline-none focus:ring-2 focus:bg-white transition-all placeholder-slate-300 shadow-inner resize-none",
                !isValidLength && wordCount > 0
                  ? "border-red-300 focus:ring-red-500"
                  : "focus:ring-blue-500"
              )}
              placeholder="Dán nội dung bài thi nói Aptis của bạn vào đây..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={isGenerating}
            />
          </div>

          {/* Gợi ý */}
          {suggestions.length > 0 && (
            <div className="animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="p-4 bg-indigo-50/40 rounded-2xl border border-indigo-100">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-bold text-indigo-900 flex items-center gap-2">
                     <Sparkles className="w-4 h-4 text-indigo-500" />
                     Gợi ý cải thiện (Bấm để áp dụng)
                  </h3>
                  <button onClick={() => setSuggestions([])} className="text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 bg-white px-2 py-1 rounded border border-slate-200 shadow-sm transition-colors">
                    Đóng
                  </button>
                </div>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {suggestions.map((s, i) => (
                     <div key={i} className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 bg-white rounded-xl shadow-sm border border-indigo-50 hover:border-indigo-200 transition-all group">
                        <div className="flex-1">
                           <div className="flex items-center flex-wrap gap-2 mb-1">
                              <span className={cn(
                                  "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                                  s.type === 'synonym' ? "bg-amber-100 text-amber-700" :
                                  s.type === 'structure' ? "bg-emerald-100 text-emerald-700" :
                                  "bg-fuchsia-100 text-fuchsia-700"
                              )}>
                                 {s.type === 'synonym' ? 'Từ vựng' : s.type === 'structure' ? 'Cấu trúc' : 'Thành ngữ'}
                              </span>
                              <span className="text-sm text-slate-400 line-through decoration-slate-300">{s.original}</span>
                              <span className="text-slate-300">→</span>
                              <span className="text-sm font-bold text-indigo-700">{s.replacement}</span>
                           </div>
                           <p className="text-xs text-slate-500">{s.explanation}</p>
                        </div>
                        <button 
                           onClick={() => applySuggestion(s.original, s.replacement, i)} 
                           className="w-full md:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                        >
                           Áp dụng thay thế
                        </button>
                     </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm font-medium border border-red-200 animate-in fade-in zoom-in-95">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-4">
            <div className="space-y-4">
              <button
                onClick={() => handleGenerate('Male')}
                disabled={isGenerating || !isValidLength}
                className={cn(
                  "w-full py-4 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg transition-colors",
                  isGenerating || !isValidLength
                    ? "bg-slate-300 text-slate-50 shadow-slate-100 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-700 shadow-blue-100"
                )}
              >
                {isGenerating && activeVoice === 'Male' ? (
                  <Loader2 className="animate-spin h-5 w-5" />
                ) : (
                  <UserRound className="h-5 w-5" />
                )}
                Tạo mẫu giọng Nam
              </button>

              <div className={cn(
                "flex items-center gap-3 p-3 rounded-xl border transition-all duration-300 min-h-[72px]",
                audioUrl && activeVoice === 'Male' && !isGenerating
                  ? "bg-blue-50/50 border-blue-200 opacity-100 justify-center"
                  : "bg-slate-50 border-slate-100 opacity-60 justify-center"
              )}>
                {renderAudioPlayer('Male')}
              </div>
            </div>

            <div className="space-y-4">
              <button
                onClick={() => handleGenerate('Female')}
                disabled={isGenerating || !isValidLength}
                className={cn(
                  "w-full py-4 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg transition-colors",
                  isGenerating || !isValidLength
                    ? "bg-slate-300 text-slate-50 shadow-slate-100 cursor-not-allowed"
                    : "bg-rose-500 hover:bg-rose-600 shadow-rose-100"
                )}
              >
                {isGenerating && activeVoice === 'Female' ? (
                  <Loader2 className="animate-spin h-5 w-5" />
                ) : (
                  <User className="h-5 w-5" />
                )}
                Tạo mẫu giọng Nữ
              </button>

              <div className={cn(
                "flex items-center gap-3 p-3 rounded-xl border transition-all duration-300 min-h-[72px]",
                audioUrl && activeVoice === 'Female' && !isGenerating
                  ? "bg-rose-50/50 border-rose-200 opacity-100 justify-center"
                  : "bg-slate-50 border-slate-100 opacity-60 justify-center"
              )}>
                {renderAudioPlayer('Female')}
              </div>
            </div>
          </div>
        </div>

        <footer className="mt-10 pt-6 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex gap-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-green-400 ring-2 ring-green-100"></span> 
              AI Engine: Gemini 3.1 Flash TTS
            </div>
          </div>
          <span className="text-slate-400 text-xs font-medium">
            Phiên bản dành cho học viên APTIS
          </span>
        </footer>
      </div>
    </div>
  );
}

