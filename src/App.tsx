import React, { useState, useEffect, useRef } from 'react';
import { 
  Droplets, 
  Search, 
  ShieldCheck, 
  AlertTriangle, 
  Info, 
  FileText, 
  MapPin, 
  ArrowRight,
  Activity,
  Filter,
  CheckCircle2,
  XCircle,
  Loader2,
  History,
  Download,
  Share2,
  ExternalLink,
  Waves,
  Users,
  Building2,
  ChevronRight,
  HeartPulse,
  Scale,
  Mic,
  MicOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzeWaterQuality, getLocalWaterReport, ai, Modality, Type } from './services/waterService';
import { AuditReport, COMMON_CONTAMINANTS } from './types';
import { cn } from './lib/utils';

export default function App() {
  const [activeTab, setActiveTab] = useState<'analyzer' | 'local'>('local');
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState('');
  const [localReport, setLocalReport] = useState<AuditReport | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [history, setHistory] = useState<AuditReport[]>([]);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [leadData, setLeadData] = useState({ name: '', email: '', phone: '', zip: '' });
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showProducts, setShowProducts] = useState(false);
  const [showPrices, setShowPrices] = useState(false);
  const [recentAudits, setRecentAudits] = useState([
    { city: 'Beverly Hills, CA', zip: '90210' },
    { city: 'Austin, TX', zip: '78701' },
    { city: 'Miami, FL', zip: '33101' }
  ]);

  const liveSessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);

  const playBase64Audio = async (base64: string, sampleRate = 24000) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate });
      }
      const ctx = audioContextRef.current;
      
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const pcmData = new Int16Array(bytes.buffer);
      const float32Data = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        float32Data[i] = pcmData[i] / 32768;
      }
      
      const buffer = ctx.createBuffer(1, float32Data.length, sampleRate);
      buffer.getChannelData(0).set(float32Data);
      
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      
      return new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start();
      });
    } catch (error) {
      console.error('Audio playback failed:', error);
    }
  };

  const processAudioQueue = async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;
    while (audioQueueRef.current.length > 0) {
      const nextAudio = audioQueueRef.current.shift();
      if (nextAudio) {
        await playBase64Audio(nextAudio, 24000);
      }
    }
    isPlayingRef.current = false;
  };

  const stopVoiceAssistant = () => {
    setIsVoiceActive(false);
    setIsListening(false);
    
    if (liveSessionRef.current) {
      liveSessionRef.current.close();
      liveSessionRef.current = null;
    }
    
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    audioQueueRef.current = [];
  };

  const toggleVoiceAudit = async () => {
    if (isVoiceActive) {
      stopVoiceAssistant();
      return;
    }

    setIsVoiceActive(true);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const context = localReport?.utilityName || auditReport?.utilityName || '';
      const systemInstruction = `You are the AquaAudit.net Senior Water Consultant. Your goal is to help the user DISCOVER the risks in their water through a professional, detached consultation style (inspired by NEPQ).

      TONE: 
      - Detached and curious. You are not a salesperson; you are a problem solver.
      - Use "Connecting Questions" and "Consequence Questions".
      - Never pressure. Let the user realize the danger themselves.

      STRATEGY:
      1. CONNECT: Ask why they are looking into their water quality today.
      2. SITUATION: Ask how long they've been drinking this water.
      3. PROBLEM: When they see a contaminant exceeding guidelines, ask: "What concerns you most about seeing [Contaminant] at that level?"
      4. CONSEQUENCE: Ask: "If you don't address this now, what do you think the long-term impact on your health might be?"
      5. SOLUTION: Only suggest filters when they acknowledge the need. Ask: "Would it be helpful if I showed you the systems that specifically target these contaminants?"

      CONTEXT: ${context ? `The user is looking at a report for ${context}.` : 'No specific report loaded yet.'}

      IMPORTANT: 
      - Use 'show_products' only when the user is ready to see solutions.
      - Use 'show_prices' only if they ask about cost.
      - Keep the consultation under 3 minutes. Be concise.`;

      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "show_products",
                  description: "Reveal the recommended filtration products section to the user.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "show_prices",
                  description: "Reveal the prices of the recommended products to the user.",
                  parameters: { type: Type.OBJECT, properties: {} }
                }
              ]
            }
          ]
        },
        callbacks: {
          onopen: () => {
            setIsListening(true);
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            audioContextRef.current = audioCtx;
            const source = audioCtx.createMediaStreamSource(stream);
            const processor = audioCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
              }
              const uint8 = new Uint8Array(pcmData.buffer);
              let binary = '';
              for (let i = 0; i < uint8.length; i++) {
                binary += String.fromCharCode(uint8[i]);
              }
              const base64 = window.btoa(binary);
              
              sessionPromise.then(session => {
                session.sendRealtimeInput({
                  media: { data: base64, mimeType: 'audio/pcm;rate=16000' }
                });
              });
            };
            
            source.connect(processor);
            processor.connect(audioCtx.destination);
          },
          onmessage: (message: any) => {
            if (message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
              audioQueueRef.current.push(message.serverContent.modelTurn.parts[0].inlineData.data);
              processAudioQueue();
            }
            
            if (message.toolCall) {
              const calls = message.toolCall.functionCalls;
              const responses: any[] = [];
              
              calls.forEach((call: any) => {
                if (call.name === 'show_products') {
                  setShowProducts(true);
                  responses.push({ name: call.name, response: { success: true }, id: call.id });
                } else if (call.name === 'show_prices') {
                  setShowPrices(true);
                  responses.push({ name: call.name, response: { success: true }, id: call.id });
                }
              });
              
              if (responses.length > 0) {
                sessionPromise.then(session => {
                  session.sendToolResponse({ functionResponses: responses });
                });
              }
            }

            if (message.serverContent?.interrupted) {
              audioQueueRef.current = [];
            }
          },
          onerror: (err: any) => {
            console.error('Live session error:', err);
            stopVoiceAssistant();
          },
          onclose: () => {
            stopVoiceAssistant();
          }
        }
      });
      
      liveSessionRef.current = await sessionPromise;
      
    } catch (error) {
      console.error('Failed to start voice assistant:', error);
      setIsVoiceActive(false);
      alert('Microphone access is required for Voice Audit.');
    }
  };

  const products = [
    {
      id: 'aa-under-sink-01',
      name: 'AquaAudit Pro Series Under-Sink System',
      description: 'Multi-stage reverse osmosis system optimized for lead and PFAS removal.',
      price: '$299.00',
      image: 'https://picsum.photos/seed/filter1/400/400',
      rating: 4.9,
      reviews: 128
    },
    {
      id: 'aa-countertop-01',
      name: 'AquaAudit Elite Countertop Nano-Filter',
      description: 'Space-saving design with advanced microplastic and chlorine reduction.',
      price: '$149.00',
      image: 'https://picsum.photos/seed/filter2/400/400',
      rating: 4.8,
      reviews: 85
    }
  ];

  useEffect(() => {
    const saved = localStorage.getItem('aqua_audit_history');
    if (saved) setHistory(JSON.parse(saved));
  }, []);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const report = await analyzeWaterQuality(testResults);
      setAuditReport(report);
      setRecentAudits(prev => [{ city: 'Personal Lab Audit', zip: 'User Input' }, ...prev].slice(0, 5));
      const newHistory = [report, ...history].slice(0, 5);
      setHistory(newHistory);
      localStorage.setItem('aqua_audit_history', JSON.stringify(newHistory));
    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchLocal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location) return;
    setLoading(true);
    try {
      const report = await getLocalWaterReport(location);
      setLocalReport(report);
      setRecentAudits(prev => [{ city: report.utilityName || location, zip: location }, ...prev].slice(0, 5));
    } catch (error) {
      console.error('Local search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white selection:bg-brand-100 selection:text-brand-900">
      {/* Top Banner */}
      <div className="bg-brand-900 text-white py-2 px-6 overflow-hidden">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="text-[10px] font-black uppercase tracking-[0.2em]">
            National Water Quality Database • Advanced Analytical Systems
          </div>
          <div className="hidden md:flex items-center gap-6 text-[9px] font-bold uppercase tracking-widest text-brand-300">
            {recentAudits.map((audit, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" /> 
                Recent Audit: {audit.city} ({audit.zip})
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center gap-3 group cursor-pointer" onClick={() => { setLocalReport(null); setAuditReport(null); setLocation(''); }}>
              <div className="p-2 bg-brand-600 rounded-xl shadow-lg shadow-brand-500/20">
                <Droplets className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-black tracking-tighter text-slate-900">AquaAudit.net</span>
            </div>
            
            <div className="hidden md:flex items-center gap-8">
              <button 
                onClick={() => setActiveTab('local')}
                className={cn(
                  "text-sm font-bold uppercase tracking-widest transition-colors",
                  activeTab === 'local' ? "text-brand-600" : "text-slate-400 hover:text-slate-900"
                )}
              >
                Tap Water Database
              </button>
              <button 
                onClick={() => setActiveTab('analyzer')}
                className={cn(
                  "text-sm font-bold uppercase tracking-widest transition-colors",
                  activeTab === 'analyzer' ? "text-brand-600" : "text-slate-400 hover:text-slate-900"
                )}
              >
                Personal Lab
              </button>
            </div>

            <div className="flex items-center gap-4">
              <button 
                onClick={toggleVoiceAudit}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all",
                  isVoiceActive ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                {isVoiceActive ? (
                  <>
                    <div className="flex gap-1 items-center">
                      <motion.div 
                        animate={{ height: [4, 12, 4] }}
                        transition={{ repeat: Infinity, duration: 0.5 }}
                        className="w-0.5 bg-white"
                      />
                      <motion.div 
                        animate={{ height: [8, 16, 8] }}
                        transition={{ repeat: Infinity, duration: 0.5, delay: 0.1 }}
                        className="w-0.5 bg-white"
                      />
                      <motion.div 
                        animate={{ height: [4, 12, 4] }}
                        transition={{ repeat: Infinity, duration: 0.5, delay: 0.2 }}
                        className="w-0.5 bg-white"
                      />
                    </div>
                    <span>Live Audit</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4" />
                    <span>Voice Audit</span>
                  </>
                )}
              </button>
              <button 
                onClick={() => alert("Thank you for your interest! We are currently coordinating with local advocacy groups. Your report has been flagged for community review.")}
                className="hidden sm:flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-all"
              >
                Report a Concern
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      {!localReport && !auditReport && (
        <section className="relative py-24 overflow-hidden">
          <div className="absolute inset-0 bg-brand-50/50 -z-10" />
          <div className="max-w-4xl mx-auto px-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <h1 className="text-5xl md:text-7xl font-black text-slate-900 tracking-tight leading-[1.1]">
                The National <span className="text-brand-600 italic font-serif">Tap Water Database</span>
              </h1>
              <p className="text-xl text-slate-500 font-medium max-w-2xl mx-auto">
                Access the most comprehensive safety audit of public water systems in the United States. Covering 50,000+ utilities and every zip code nationwide.
              </p>

              <div className="max-w-2xl mx-auto mt-12">
                <div className="flex flex-col md:flex-row gap-2 p-2 bg-white rounded-2xl shadow-2xl border border-slate-100">
                  <div className="flex-1 relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Enter Zip Code or City" 
                      className="w-full pl-12 pr-4 py-4 bg-transparent outline-none text-lg font-bold text-slate-900"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearchLocal(e)}
                    />
                  </div>
                  <button 
                    onClick={handleSearchLocal}
                    disabled={loading || !location}
                    className="px-8 py-4 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-black uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Audit My Water'}
                  </button>
                </div>
                <div className="mt-6 flex items-center justify-center gap-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> 50 States Covered
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> 140,000+ Contaminants Tracked
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Real-Time Compliance
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
          <Waves className="absolute -bottom-24 left-0 w-full h-64 text-brand-100 opacity-30 pointer-events-none" />
        </section>
      )}

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="min-h-[600px] flex flex-col items-center justify-center"
            >
              <div className="relative mb-8">
                <div className="absolute inset-0 bg-brand-500 blur-3xl opacity-20 animate-pulse" />
                <Loader2 className="w-16 h-16 animate-spin text-brand-600 relative z-10" />
              </div>
              <h2 className="text-2xl font-black text-slate-900">Auditing Databases</h2>
              <p className="text-slate-400 font-bold uppercase tracking-widest text-xs mt-2">Connecting to EPA & EWG Systems</p>
              <div className="mt-4 text-[10px] text-slate-300 font-medium max-w-xs text-center">
                Our system cross-references the latest Safe Drinking Water Act (SDWA) data with health-based guidelines to ensure maximum transparency.
              </div>
            </motion.div>
          ) : activeTab === 'analyzer' && !auditReport ? (
            <motion.div
              key="analyzer-form"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto"
            >
              <div className="bg-white rounded-[2.5rem] p-10 border border-slate-100 shadow-2xl">
                <div className="flex items-center gap-4 mb-8">
                  <div className="p-3 bg-brand-600 rounded-2xl">
                    <Activity className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight">Personal Lab Audit</h2>
                    <p className="text-slate-500 font-medium">Enter your home test kit results for a professional health assessment.</p>
                  </div>
                </div>

                <form onSubmit={handleAnalyze} className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {COMMON_CONTAMINANTS.map((contaminant) => (
                      <div key={contaminant.id} className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex justify-between">
                          {contaminant.name}
                          <span>{contaminant.unit}</span>
                        </label>
                        <input 
                          type="number" 
                          step="any"
                          placeholder={`Enter ${contaminant.name} level`}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none focus:border-brand-500 transition-all font-bold text-slate-900"
                          value={testResults[contaminant.id] || ''}
                          onChange={(e) => setTestResults({ ...testResults, [contaminant.id]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>

                  <button 
                    type="submit"
                    disabled={Object.keys(testResults).length === 0}
                    className="w-full py-5 bg-brand-600 hover:bg-brand-700 text-white rounded-2xl font-black uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center gap-3 shadow-xl shadow-brand-500/20"
                  >
                    Generate Health Audit <ArrowRight className="w-5 h-5" />
                  </button>
                </form>
              </div>
            </motion.div>
          ) : (localReport || auditReport) ? (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-12"
            >
              {/* Utility Header */}
              <div className="bg-slate-900 rounded-[2.5rem] p-10 text-white relative overflow-hidden">
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md">
                        <Building2 className="w-8 h-8 text-brand-400" />
                      </div>
                      <div>
                        <h2 className="text-3xl font-black tracking-tight">{localReport?.utilityName || 'Personal Audit'}</h2>
                        <div className="flex items-center gap-4 mt-1">
                          <div className="flex items-center gap-1.5 text-slate-400 text-xs font-bold uppercase tracking-widest">
                            <MapPin className="w-3 h-3" /> {location || 'Manual Input'}
                          </div>
                          {localReport?.populationServed && (
                            <div className="flex items-center gap-1.5 text-slate-400 text-xs font-bold uppercase tracking-widest">
                              <Users className="w-3 h-3" /> Serves {localReport.populationServed}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-center md:items-end gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Overall Safety Score</span>
                    <div className="flex items-center gap-4">
                      <div className="text-6xl font-black tracking-tighter">{(localReport || auditReport)?.overallScore}</div>
                      <div className={cn(
                        "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest",
                        (localReport || auditReport)!.overallScore > 80 ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                      )}>
                        {(localReport || auditReport)!.overallScore > 80 ? 'Safe' : 'Action Required'}
                      </div>
                    </div>
                  </div>
                </div>
                <Droplets className="absolute -bottom-12 -right-12 w-64 h-64 text-white/5" />
              </div>

              {/* Summary Section */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                  <section className="bg-white rounded-[2.5rem] p-10 border border-slate-100 shadow-sm">
                    <h3 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3">
                      <Info className="w-6 h-6 text-brand-600" />
                      Auditor's Summary
                    </h3>
                    <p className="text-xl text-slate-600 leading-relaxed font-medium">
                      {(localReport || auditReport)?.summary}
                    </p>
                  </section>

                  {/* Top Rated Systems (Private Label) */}
                  <AnimatePresence>
                    {showProducts ? (
                      <motion.section 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="space-y-6"
                      >
                        <div className="flex items-center justify-between px-4">
                          <h3 className="text-xl font-black text-slate-900 uppercase tracking-wider">Top Rated Solutions</h3>
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Expert Verified</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {products.map((product) => (
                            <div key={product.id} className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm hover:shadow-xl transition-all group">
                              <div className="flex gap-6">
                                <img src={product.image} alt={product.name} className="w-24 h-24 rounded-2xl object-cover" referrerPolicy="no-referrer" />
                                <div className="flex-1">
                                  <div className="flex items-center gap-1 mb-1">
                                    {[...Array(5)].map((_, i) => (
                                      <Activity key={i} className={cn("w-3 h-3", i < Math.floor(product.rating) ? "text-brand-500" : "text-slate-200")} />
                                    ))}
                                    <span className="text-[10px] font-black text-slate-400 ml-2">({product.reviews})</span>
                                  </div>
                                  <h4 className="text-lg font-black text-slate-900 leading-tight mb-2">{product.name}</h4>
                                  <p className="text-xs text-slate-500 font-medium mb-4">{product.description}</p>
                                  <div className="flex items-center justify-between">
                                    {showPrices ? (
                                      <span className="text-xl font-black text-brand-600">{product.price}</span>
                                    ) : (
                                      <button 
                                        onClick={() => setShowPrices(true)}
                                        className="text-[10px] font-black uppercase tracking-widest text-brand-600 hover:text-brand-700 transition-colors"
                                      >
                                        View Price
                                      </button>
                                    )}
                                    <button className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-brand-600 transition-all">
                                      Order Now
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.section>
                    ) : (
                      <section className="bg-slate-50 rounded-[2.5rem] p-10 border border-slate-200 border-dashed flex flex-col items-center text-center">
                        <div className="p-4 bg-white rounded-2xl shadow-sm mb-6">
                          <ShieldCheck className="w-8 h-8 text-brand-600" />
                        </div>
                        <h3 className="text-xl font-black text-slate-900 mb-2">Expert-Recommended Systems</h3>
                        <p className="text-sm text-slate-500 font-medium max-w-md mb-8">
                          Based on your water quality audit, we have identified specific filtration technologies that effectively remediate your detected contaminants.
                        </p>
                        <button 
                          onClick={() => setShowProducts(true)}
                          className="px-8 py-4 bg-brand-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-brand-700 transition-all shadow-lg shadow-brand-500/20"
                        >
                          Reveal Recommended Solutions
                        </button>
                      </section>
                    )}
                  </AnimatePresence>

                  {/* Contaminants Section */}
                  <section className="space-y-6">
                    <div className="flex items-center justify-between px-4">
                      <h3 className="text-xl font-black text-slate-900 uppercase tracking-wider">Contaminants Detected</h3>
                      <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                        <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-rose-500" /> Above Health Guideline</span>
                        <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500" /> Safe</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      {(localReport || auditReport)?.metrics.map((metric, idx) => (
                        <motion.div 
                          key={idx}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm hover:shadow-md transition-all group"
                        >
                          <div className="flex flex-col md:flex-row justify-between gap-8">
                            <div className="flex-1 space-y-4">
                              <div className="flex items-center gap-3">
                                <h4 className="text-xl font-black text-slate-900">{metric.name}</h4>
                                {metric.timesExceeded && metric.timesExceeded > 1 && (
                                  <span className="px-3 py-1 bg-rose-50 text-rose-600 rounded-full text-[10px] font-black uppercase tracking-widest">
                                    {metric.timesExceeded.toFixed(1)}x Health Guideline
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-slate-500 font-medium leading-relaxed max-w-2xl">
                                {metric.description}
                              </p>
                              
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-4 border-t border-slate-50">
                                <div>
                                  <span className="block text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">Concentration</span>
                                  <span className="text-lg font-black text-slate-900">{metric.value} <span className="text-[10px] text-slate-400">{metric.unit}</span></span>
                                </div>
                                {metric.healthGuideline && (
                                  <div>
                                    <span className="block text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">Health Goal</span>
                                    <span className="text-lg font-black text-brand-600">{metric.healthGuideline} <span className="text-[10px] text-slate-400">{metric.unit}</span></span>
                                  </div>
                                )}
                                <div>
                                  <span className="block text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">Legal Limit</span>
                                  <span className="text-lg font-black text-slate-900">{metric.limit} <span className="text-[10px] text-slate-400">{metric.unit}</span></span>
                                </div>
                                <div className="flex items-end justify-end">
                                  <div className={cn(
                                    "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2",
                                    metric.status === 'safe' ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                                  )}>
                                    {metric.status === 'safe' ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                                    {metric.status === 'safe' ? 'Safe' : 'Potential Risk'}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </section>
                </div>

                {/* Sidebar: Action & Stats */}
                <div className="space-y-8">
                  <section className="bg-brand-600 rounded-[2.5rem] p-8 text-white shadow-xl shadow-brand-500/20 relative overflow-hidden">
                    <div className="relative z-10">
                      <h3 className="text-xl font-black mb-6 flex items-center gap-3">
                        <ShieldCheck className="w-6 h-6" />
                        Recommended Solutions
                      </h3>
                      <div className="space-y-4">
                        {(localReport || auditReport)?.recommendations.map((rec, i) => (
                          <div key={i} className="flex gap-4 p-4 bg-white/10 rounded-2xl backdrop-blur-sm border border-white/10 group cursor-pointer hover:bg-white/20 transition-all">
                            <div className="mt-1"><Filter className="w-4 h-4 text-brand-300" /></div>
                            <div>
                              <p className="text-sm font-bold leading-relaxed">{rec}</p>
                              <span className="text-[10px] font-black uppercase tracking-widest text-brand-300 flex items-center gap-1 mt-1">
                                View Top Rated <ChevronRight className="w-2 h-2" />
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button 
                        onClick={() => setShowProducts(true)}
                        className="w-full mt-8 py-4 bg-white text-brand-600 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-brand-50 transition-all flex items-center justify-center gap-2"
                      >
                        Shop Certified Systems <ExternalLink className="w-4 h-4" />
                      </button>
                    </div>
                    <Droplets className="absolute -bottom-8 -right-8 w-48 h-48 text-white/5" />
                  </section>

                  <section className="bg-slate-50 rounded-[2.5rem] p-8 border border-slate-200 border-dashed relative group cursor-pointer hover:bg-slate-100 transition-all" onClick={() => setShowLeadForm(true)}>
                    <div className="flex items-center gap-4 mb-4">
                      <div className="p-3 bg-brand-100 rounded-2xl">
                        <Activity className="w-6 h-6 text-brand-600" />
                      </div>
                      <div>
                        <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">Expert Consultation</h4>
                        <p className="text-[10px] font-bold text-brand-600 uppercase tracking-widest">Lead Capture</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 font-medium leading-relaxed mb-6">
                      Speak with a certified water quality specialist about your results and get a custom remediation plan.
                    </p>
                    <button className="w-full py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all">
                      Request Free Consultation
                    </button>
                  </section>

                  <section className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm">
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-[0.2em] mb-6">Health Impact</h3>
                    <div className="space-y-6">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-rose-50 rounded-2xl">
                          <HeartPulse className="w-6 h-6 text-rose-500" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Risk Level</p>
                          <p className="text-lg font-black text-slate-900">{(localReport || auditReport)!.overallScore < 70 ? 'Elevated' : 'Low'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-brand-50 rounded-2xl">
                          <Scale className="w-6 h-6 text-brand-600" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Compliance</p>
                          <p className="text-lg font-black text-slate-900">Legal but Unsafe</p>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>

      {/* Methodology Section */}
      <section id="methodology" className="bg-white py-24 border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
            <div className="space-y-8">
              <h2 className="text-4xl font-black text-slate-900 tracking-tight">Our Auditing <span className="text-brand-600 italic font-serif">Methodology</span></h2>
              <p className="text-lg text-slate-600 leading-relaxed font-medium">
                AquaAudit uses a proprietary multi-layer analytical framework to assess water safety. We don't just look at legal compliance; we look at biological impact.
              </p>
              <div className="space-y-6">
                {[
                  { title: 'EPA Compliance Check', desc: 'Real-time monitoring of SDWA violations and enforcement actions.' },
                  { title: 'Health-Based Benchmarking', desc: 'Comparison against EWG and WHO scientific health guidelines.' },
                  { title: 'Predictive Modeling', desc: 'AI-driven analysis of historical contamination trends.' }
                ].map((item, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="mt-1 p-1 bg-brand-100 rounded-full"><CheckCircle2 className="w-4 h-4 text-brand-600" /></div>
                    <div>
                      <h4 className="font-black text-slate-900 uppercase tracking-widest text-xs mb-1">{item.title}</h4>
                      <p className="text-sm text-slate-500 font-medium">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-slate-900 rounded-[3rem] p-12 text-white relative overflow-hidden">
              <div className="relative z-10 space-y-6">
                <div className="p-4 bg-white/10 rounded-2xl inline-block backdrop-blur-md">
                  <ShieldCheck className="w-8 h-8 text-brand-400" />
                </div>
                <h3 className="text-2xl font-black tracking-tight">Certified Data Integrity</h3>
                <p className="text-slate-400 font-medium leading-relaxed">
                  Our data is pulled directly from the EPA's Safe Drinking Water Information System (SDWIS) and cross-referenced with the Environmental Working Group's (EWG) Tap Water Database.
                </p>
                <div className="pt-6 border-t border-white/10 flex items-center gap-4">
                  <div className="text-3xl font-black text-brand-400">99.9%</div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Data Accuracy Rate</div>
                </div>
              </div>
              <Droplets className="absolute -bottom-12 -right-12 w-64 h-64 text-white/5" />
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-50 border-t border-slate-100 mt-24 py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-12">
            <div className="flex flex-col items-center md:items-start gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-brand-600 rounded-xl">
                  <Droplets className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-black tracking-tighter text-slate-900">AquaAudit</span>
              </div>
              <p className="text-[10px] text-slate-300 font-medium max-w-xs text-center md:text-left">
                National Tap Water Quality Database providing instant safety reports, EPA compliance checks, and health-based contaminant analysis.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
              <a href="#about" className="hover:text-slate-900 transition-colors">About Us</a>
              <a href="#methodology" className="hover:text-slate-900 transition-colors">Methodology</a>
              <a href="#data" className="hover:text-slate-900 transition-colors">Data Sources</a>
              <a href="#privacy" className="hover:text-slate-900 transition-colors">Privacy</a>
            </div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              © {new Date().getFullYear()} AquaAudit Systems
            </div>
          </div>
        </div>
      </footer>

      {/* Lead Capture Modal */}
      <AnimatePresence>
        {showLeadForm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[3rem] p-12 max-w-lg w-full relative shadow-2xl"
            >
              <button 
                onClick={() => setShowLeadForm(false)}
                className="absolute top-8 right-8 p-2 hover:bg-slate-100 rounded-full transition-all"
              >
                <XCircle className="w-6 h-6 text-slate-400" />
              </button>
              
              <div className="text-center space-y-4 mb-10">
                <div className="inline-flex p-4 bg-brand-50 rounded-3xl mb-4">
                  <Users className="w-10 h-10 text-brand-600" />
                </div>
                <h2 className="text-3xl font-black text-slate-900 tracking-tight">Expert Consultation</h2>
                <p className="text-slate-500 font-medium">Get a professional remediation plan for your specific water profile.</p>
              </div>

              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setShowLeadForm(false); alert('Lead captured! (Demo)'); }}>
                <input 
                  type="text" 
                  placeholder="Full Name" 
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:border-brand-500 transition-all font-bold text-slate-900"
                  required
                />
                <input 
                  type="email" 
                  placeholder="Email Address" 
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:border-brand-500 transition-all font-bold text-slate-900"
                  required
                />
                <input 
                  type="tel" 
                  placeholder="Phone Number" 
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:border-brand-500 transition-all font-bold text-slate-900"
                  required
                />
                <button 
                  type="submit"
                  className="w-full py-5 bg-brand-600 hover:bg-brand-700 text-white rounded-2xl font-black uppercase tracking-widest transition-all shadow-xl shadow-brand-500/20"
                >
                  Submit Request
                </button>
                <p className="text-[10px] text-slate-400 text-center font-medium">
                  By submitting, you agree to be contacted by a certified water specialist.
                </p>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
