"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageSquare,
  Phone,
  Video,
  X,
  Send,
  Mic,
  MicOff,
  VideoOff,
  PhoneOff,
  User,
  Clock,
  Play,
  Pause,
  Square,
  Trash2,
  PhoneIncoming,
  PhoneMissed,
  Moon,
  Sun,
} from "lucide-react";
import { io, Socket } from "socket.io-client";

interface Message {
  id: string;
  type: "customer" | "operator" | "system";
  text: string;
  timestamp: string;
  senderName: string;
  isVoice?: boolean;
  audioData?: string;
  voiceDuration?: number;
}

interface PreMessage {
  id: string;
  text: string;
  timestamp: string;
  isVoice?: boolean;
  audioData?: string;
}

interface OperatorInfo {
  operatorId: string;
  operatorName: string;
}

export default function TalkPage() {
  // Theme
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Connection states
  const [name, setName] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [preMessages, setPreMessages] = useState<PreMessage[]>([]);
  const [preMessageInput, setPreMessageInput] = useState("");

  // Chat states
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Operator assignment
  const [operator, setOperator] = useState<OperatorInfo | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const [waitTime, setWaitTime] = useState(0);
  const waitTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Typing indicator
  const [isTyping, setIsTyping] = useState(false);
  const [operatorTyping, setOperatorTyping] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Voice recording for pre-messages
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // WebRTC states
  const [isCallActive, setIsCallActive] = useState(false);
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCall, setIncomingCall] = useState<{
    operatorId: string;
    operatorName: string;
    offer: RTCSessionDescriptionInit;
    type: "audio" | "video";
  } | null>(null);
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "ringing" | "connected">("idle");

  // Refs
  const socketRef = useRef<Socket | null>(null);
  const customerIdRef = useRef<string | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Dynamic WebSocket URL
  const getWSUrl = () => {
    if (typeof window === "undefined") return "http://localhost:3002";

    // Cloudflare tunnel support - gebruik specifieke URL
    const hostname = window.location.hostname;

    // Als we op trycloudflare.com zitten, gebruik de juiste WebSocket tunnel URL
    if (hostname.includes('trycloudflare.com')) {
      // De WebSocket heeft zijn eigen tunnel URL
      // Vervang dit met de juiste URL wanneer de tunnel verandert
      return "https://chuck-grab-lighter-korean.trycloudflare.com";
    }

    // Lokale ontwikkeling
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    return `${protocol}//${hostname}:3002`;
  };
  const WS_URL = process.env.NEXT_PUBLIC_WS_URL || getWSUrl();

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Wait timer
  useEffect(() => {
    if (isConnected) {
      waitTimerRef.current = setInterval(() => {
        setWaitTime((prev) => prev + 1);
      }, 1000);
    } else {
      if (waitTimerRef.current) {
        clearInterval(waitTimerRef.current);
        waitTimerRef.current = null;
      }
    }
    return () => {
      if (waitTimerRef.current) {
        clearInterval(waitTimerRef.current);
      }
    };
  }, [isConnected]);

  const formatWaitTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Add pre-message
  const handleAddPreMessage = () => {
    if (!preMessageInput.trim()) return;

    const newPreMessage: PreMessage = {
      id: Date.now().toString(),
      text: preMessageInput.trim(),
      timestamp: new Date().toISOString(),
      isVoice: false,
    };

    setPreMessages((prev) => [...prev, newPreMessage]);
    setPreMessageInput("");
  };

  const handleDeletePreMessage = (id: string) => {
    setPreMessages((prev) => prev.filter((msg) => msg.id !== id));
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          const newPreMessage: PreMessage = {
            id: Date.now().toString(),
            text: "🎤 Spraakbericht",
            timestamp: new Date().toISOString(),
            isVoice: true,
            audioData: base64Audio,
          };
          setPreMessages((prev) => [...prev, newPreMessage]);
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Kan geen toegang krijgen tot microfoon");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!name.trim()) {
      setConnectionError("Voer je naam in");
      return;
    }

    setIsConnecting(true);
    setConnectionError("");

    const socket = io(WS_URL, {
      query: {
        name: name.trim(),
        type: "customer",
        preMessages: JSON.stringify(preMessages),
      },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      timeout: 20000,
      // Gebruik alleen polling voor Cloudflare tunnels (websocket upgrade werkt niet altijd)
      transports: ["polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[Customer] Connected to WebSocket");
      setIsConnected(true);
      setIsConnecting(false);
      setIsWaiting(true);
    });

    socket.on("connect_error", (err) => {
      console.error("[Customer] Connection error:", err);
      setConnectionError("Kan geen verbinding maken met de server.");
      setIsConnecting(false);
    });

    socket.on("customer_connected", (data: { customerId: string; customerName: string }) => {
      console.log("[Customer] Connected with ID:", data.customerId);
      customerIdRef.current = data.customerId;
    });

    socket.on("operator_assigned", (data: OperatorInfo) => {
      console.log("[Customer] Operator assigned:", data);
      setOperator(data);
      setIsWaiting(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          type: "system",
          text: `${data.operatorName} is nu verbonden en helpt je graag.`,
          timestamp: new Date().toISOString(),
          senderName: "Systeem",
        },
      ]);
    });

    socket.on("incoming_call", (data: { operatorId: string; operatorName: string; offer: RTCSessionDescriptionInit; type: "audio" | "video" }) => {
      console.log("[Customer] Incoming call from operator:", data);
      setIncomingCall(data);
      setCallStatus("ringing");
    });

    socket.on("call_accepted", async (data: { answer: RTCSessionDescriptionInit }) => {
      console.log("[Customer] Call accepted by operator");
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        setCallStatus("connected");
      }
    });

    socket.on("call_ended", () => {
      console.log("[Customer] Call ended by operator");
      endCall();
    });

    socket.on("call_rejected", () => {
      console.log("[Customer] Call rejected by operator");
      setCallStatus("idle");
      setIsCallActive(false);
      setIsVideoActive(false);
      setIncomingCall(null);
      cleanupMedia();
    });

    socket.on("ice_candidate", async (data: { candidate: RTCIceCandidateInit }) => {
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error("[Customer] Error adding ICE candidate:", e);
        }
      }
    });

    socket.on("message", (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on("operator_typing", (data: { isTyping: boolean }) => {
      setOperatorTyping(data.isTyping);
    });

    socket.on("operator_left", () => {
      setOperator(null);
      setIsWaiting(true);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          type: "system",
          text: "De operator heeft de chat verlaten.",
          timestamp: new Date().toISOString(),
          senderName: "Systeem",
        },
      ]);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    return () => {
      socket.close();
    };
  }, [name, preMessages, WS_URL]);

  // Create peer connection
  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.ontrack = (event) => {
      console.log("[Customer] Received remote track");
      if (event.streams && event.streams[0]) {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = event.streams[0];
          remoteAudioRef.current.play().catch(console.error);
        }
        if (remoteVideoRef.current && isVideoActive) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current && operator) {
        socketRef.current.emit("webrtc_ice_candidate", {
          operatorId: operator.operatorId,
          candidate: event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("[Customer] Connection state:", pc.connectionState);
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        endCall();
      }
    };

    return pc;
  };

  // Start voice call
  const startVoiceCall = async () => {
    if (!socketRef.current || !operator) {
      alert("Wacht tot je bent verbonden met een operator");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      const pc = createPeerConnection();
      peerConnectionRef.current = pc;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socketRef.current.emit("webrtc_offer_customer", {
        operatorId: operator.operatorId,
        offer,
        type: "audio",
      });

      setIsCallActive(true);
      setIsVideoActive(false);
      setCallStatus("calling");
    } catch (err) {
      console.error("[Customer] Error starting voice call:", err);
      alert("Kan geen toegang krijgen tot microfoon");
    }
  };

  // Start video call
  const startVideoCall = async () => {
    if (!socketRef.current || !operator) {
      alert("Wacht tot je bent verbonden met een operator");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const pc = createPeerConnection();
      peerConnectionRef.current = pc;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socketRef.current.emit("webrtc_offer_customer", {
        operatorId: operator.operatorId,
        offer,
        type: "video",
      });

      setIsCallActive(true);
      setIsVideoActive(true);
      setCallStatus("calling");
    } catch (err) {
      console.error("[Customer] Error starting video call:", err);
      alert("Kan geen toegang krijgen tot camera/microfoon");
    }
  };

  // Accept incoming call
  const acceptCall = async () => {
    if (!incomingCall || !socketRef.current || !operator) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: incomingCall.type === "video",
      });
      localStreamRef.current = stream;

      if (incomingCall.type === "video" && localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const pc = createPeerConnection();
      peerConnectionRef.current = pc;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketRef.current.emit("webrtc_answer", {
        operatorId: operator.operatorId,
        answer,
      });

      setIsCallActive(true);
      setIsVideoActive(incomingCall.type === "video");
      setCallStatus("connected");
      setIncomingCall(null);
      startCallTimer();
    } catch (err) {
      console.error("[Customer] Error accepting call:", err);
      alert("Kan geen toegang krijgen tot microfoon/camera");
      rejectCall();
    }
  };

  // Reject incoming call
  const rejectCall = () => {
    if (socketRef.current && operator) {
      socketRef.current.emit("call_rejected", { operatorId: operator.operatorId });
    }
    setIncomingCall(null);
    setCallStatus("idle");
    cleanupMedia();
  };

  // End call
  const endCall = () => {
    if (socketRef.current && operator) {
      socketRef.current.emit("end_call", { operatorId: operator.operatorId });
    }
    cleanupMedia();
    setIsCallActive(false);
    setIsVideoActive(false);
    setCallStatus("idle");
    setIncomingCall(null);
    setIsMuted(false);
    setIsCameraOff(false);
    setCallDuration(0);
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
  };

  const cleanupMedia = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
  };

  const startCallTimer = () => {
    setCallDuration(0);
    callTimerRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted((prev) => !prev);
    }
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsCameraOff((prev) => !prev);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSendMessage = () => {
    if (!inputMessage.trim() || !socketRef.current || !isConnected) return;

    const messageId = Date.now().toString();
    const plainText = inputMessage.trim();

    socketRef.current.emit("customer_message", {
      messageId,
      text: plainText,
      isEncrypted: false,
    });

    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        type: "customer",
        text: plainText,
        timestamp: new Date().toISOString(),
        senderName: name,
        isEncrypted: false,
      },
    ]);
    setInputMessage("");
  };

  const handleTyping = () => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit("typing", { isTyping: true });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socketRef.current?.emit("typing", { isTyping: false });
      }, 1000);
    }
  };

  // Theme classes
  const themeClasses = isDarkMode
    ? "min-h-screen bg-slate-900 flex flex-col"
    : "min-h-screen bg-slate-50 flex flex-col";

  const cardClasses = isDarkMode
    ? "bg-slate-800 border-slate-700"
    : "bg-white border-slate-200";

  const textClasses = isDarkMode ? "text-slate-100" : "text-slate-900";
  const subTextClasses = isDarkMode ? "text-slate-400" : "text-slate-600";
  const mutedTextClasses = isDarkMode ? "text-slate-500" : "text-slate-500";

  // Landing page
  if (!isConnected) {
    return (
      <div className={themeClasses}>
        {/* Header */}
        <div className={`${isDarkMode ? "bg-slate-800/80" : "bg-white/80"} backdrop-blur-md border-b ${isDarkMode ? "border-slate-700" : "border-slate-200"} px-4 py-4 sticky top-0 z-10`}>
          <div className="max-w-lg mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 ${isDarkMode ? "bg-blue-600" : "bg-blue-500"} rounded-xl flex items-center justify-center shadow-lg`}>
                <MessageSquare className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className={`text-lg font-semibold ${textClasses}`}>Lichtpunt</h1>
                <p className={`text-sm ${mutedTextClasses}`}>Mental Care Support</p>
              </div>
            </div>
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`p-2 rounded-full transition-colors ${isDarkMode ? "bg-slate-700 hover:bg-slate-600" : "bg-slate-100 hover:bg-slate-200"}`}
            >
              {isDarkMode ? <Sun className="w-5 h-5 text-slate-300" /> : <Moon className="w-5 h-5 text-slate-600" />}
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col items-center justify-start pt-8 px-4 pb-6">
          <div className="w-full max-w-lg">
            {/* Welcome Section */}
            <div className={`${cardClasses} rounded-2xl shadow-sm p-8 mb-4 border`}>
              <div className="text-center">
                <div className={`inline-flex items-center justify-center w-20 h-20 ${isDarkMode ? "bg-blue-600/20" : "bg-blue-50"} rounded-2xl mb-4`}>
                  <MessageSquare className={`w-10 h-10 ${isDarkMode ? "text-blue-400" : "text-blue-600"}`} />
                </div>
                <h2 className={`text-2xl font-bold ${textClasses} mb-2`}>Welkom bij Lichtpunt</h2>
                <p className={`${subTextClasses} text-base`}>We zijn er om je te helpen. Deel je situatie met ons.</p>
              </div>
            </div>

            {/* Name Input */}
            <div className={`${cardClasses} rounded-2xl shadow-sm p-6 mb-4 border`}>
              <label className={`block text-sm font-medium ${textClasses} mb-2`}>Hoe heet je?</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Voer je naam in"
                className={`w-full px-4 py-3 rounded-xl border text-base transition-colors ${
                  isDarkMode
                    ? "bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:ring-blue-500"
                    : "bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-blue-500"
                } focus:outline-none focus:ring-2`}
              />
            </div>

            {/* Situation Description */}
            <div className={`${cardClasses} rounded-2xl shadow-sm p-6 mb-4 border`}>
              <label className={`block text-sm font-medium ${textClasses} mb-2`}>Vertel ons over je situatie</label>
              <textarea
                value={preMessageInput}
                onChange={(e) => setPreMessageInput(e.target.value)}
                placeholder="Beschrijf hier wat je bezighoudt..."
                rows={4}
                className={`w-full px-4 py-3 rounded-xl border text-base resize-none transition-colors ${
                  isDarkMode
                    ? "bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:ring-blue-500"
                    : "bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-blue-500"
                } focus:outline-none focus:ring-2 mb-3`}
              />

              {/* Voice Recording Button */}
              <div className="flex items-center gap-3">
                {!isRecording ? (
                  <button
                    onClick={startRecording}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full transition-colors ${
                      isDarkMode
                        ? "bg-slate-700 hover:bg-slate-600 text-slate-300"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                    }`}
                  >
                    <Mic className="w-4 h-4" />
                    <span className="text-sm">Spraakbericht</span>
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-full transition-colors animate-pulse"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    <span className="text-sm">Stop ({formatRecordingTime(recordingTime)})</span>
                  </button>
                )}

                {preMessageInput.trim() && (
                  <button
                    onClick={handleAddPreMessage}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full transition-colors ${
                      isDarkMode ? "bg-blue-600 hover:bg-blue-500" : "bg-blue-500 hover:bg-blue-600"
                    } text-white`}
                  >
                    <Send className="w-4 h-4" />
                    <span className="text-sm">Toevoegen</span>
                  </button>
                )}
              </div>
            </div>

            {/* Added Messages */}
            {preMessages.length > 0 && (
              <div className="mb-4 space-y-2">
                {preMessages.map((msg) => (
                  <div key={msg.id} className={`flex justify-end ${isDarkMode ? "bg-blue-600" : "bg-blue-500"} text-white rounded-2xl rounded-br-md px-4 py-3`}>
                    <div className="flex items-center gap-2 flex-1">
                      {msg.isVoice ? (
                        <>
                          <Mic className="w-4 h-4" />
                          <span>Spraakbericht</span>
                        </>
                      ) : (
                        <span>{msg.text}</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeletePreMessage(msg.id)}
                      className="ml-2 p-1 hover:bg-white/20 rounded-full transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Error */}
            {connectionError && (
              <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-sm">
                {connectionError}
              </div>
            )}

            {/* Start Button */}
            <button
              onClick={connect}
              disabled={isConnecting || !name.trim()}
              className={`w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all ${
                isDarkMode
                  ? "bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700"
                  : "bg-blue-500 hover:bg-blue-600 disabled:bg-slate-300"
              } text-white disabled:cursor-not-allowed`}
            >
              {isConnecting ? "Verbinden..." : "Start Chat"}
            </button>

            {/* Privacy Note */}
            <p className={`text-center text-sm ${mutedTextClasses} mt-4`}>
              Je gesprek is vertrouwelijk en wordt veilig opgeslagen.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Call Overlay
  const renderCallOverlay = () => {
    // Incoming call (ringing)
    if (incomingCall) {
      return (
        <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col items-center justify-center">
          <div className="text-center text-white mb-12">
            <div className={`w-24 h-24 ${isDarkMode ? "bg-blue-600" : "bg-blue-500"} rounded-full flex items-center justify-center mb-6 mx-auto animate-pulse`}>
              <PhoneIncoming className="w-12 h-12" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">{incomingCall.operatorName}</h2>
            <p className="text-slate-400">
              {incomingCall.type === "video" ? "Video-oproep..." : "Spraakoproep..."}
            </p>
          </div>
          <div className="flex items-center gap-8">
            <button
              onClick={rejectCall}
              className="p-4 bg-red-500 rounded-full hover:bg-red-600 transition-colors"
            >
              <PhoneMissed className="w-8 h-8 text-white" />
            </button>
            <button
              onClick={acceptCall}
              className={`p-4 ${isDarkMode ? "bg-green-600" : "bg-green-500"} rounded-full hover:bg-green-600 transition-colors`}
            >
              <Phone className="w-8 h-8 text-white" />
            </button>
          </div>
        </div>
      );
    }

    // Calling (waiting)
    if (callStatus === "calling") {
      return (
        <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col items-center justify-center">
          <div className="text-center text-white mb-12">
            <div className={`w-24 h-24 ${isDarkMode ? "bg-blue-600" : "bg-blue-500"} rounded-full flex items-center justify-center mb-6 mx-auto animate-pulse`}>
              <Phone className="w-12 h-12" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">{operator?.operatorName}</h2>
            <p className="text-slate-400">Bellen...</p>
          </div>
          <button
            onClick={endCall}
            className="p-4 bg-red-500 rounded-full hover:bg-red-600 transition-colors"
          >
            <PhoneOff className="w-8 h-8 text-white" />
          </button>
        </div>
      );
    }

    // Active call
    if (isCallActive || isVideoActive) {
      return (
        <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col">
          {!isVideoActive && <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />}

          {isVideoActive && (
            <div className="flex-1 relative">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute top-4 left-4 text-white">
                <h3 className="font-semibold">{operator?.operatorName}</h3>
                <p className="text-sm text-slate-300">{formatDuration(callDuration)}</p>
              </div>
              <div className="absolute bottom-24 right-4 w-40 h-32 bg-slate-800 rounded-lg overflow-hidden border-2 border-white">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          )}

          {!isVideoActive && (
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className={`w-32 h-32 ${isDarkMode ? "bg-blue-600" : "bg-blue-500"} rounded-full flex items-center justify-center mb-6`}>
                <Phone className="w-16 h-16 text-white" />
              </div>
              <h2 className="text-2xl font-semibold text-white mb-2">{operator?.operatorName}</h2>
              <p className="text-slate-400 text-xl">{formatDuration(callDuration)}</p>
            </div>
          )}

          {/* Controls */}
          <div className="p-6 flex items-center justify-center gap-4">
            <button
              onClick={toggleMute}
              className={`p-4 rounded-full transition-colors ${isMuted ? "bg-red-500" : isDarkMode ? "bg-slate-700" : "bg-slate-600"}`}
            >
              {isMuted ? <MicOff className="w-6 h-6 text-white" /> : <Mic className="w-6 h-6 text-white" />}
            </button>
            {isVideoActive && (
              <button
                onClick={toggleCamera}
                className={`p-4 rounded-full transition-colors ${isCameraOff ? "bg-red-500" : isDarkMode ? "bg-slate-700" : "bg-slate-600"}`}
              >
                {isCameraOff ? <VideoOff className="w-6 h-6 text-white" /> : <Video className="w-6 h-6 text-white" />}
              </button>
            )}
            <button
              onClick={endCall}
              className="p-4 bg-red-500 rounded-full hover:bg-red-600 transition-colors"
            >
              <PhoneOff className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className={themeClasses}>
      {/* Call Overlay */}
      {renderCallOverlay()}

      {/* Header */}
      <div className={`${isDarkMode ? "bg-slate-800" : "bg-blue-500"} text-white p-4`}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-semibold">{operator?.operatorName || "Wachten op operator..."}</h1>
              <p className="text-xs text-white/70">
                {isWaiting ? `Wachtijd: ${formatWaitTime(waitTime)}` : "Online"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {operator && (
              <>
                <button
                  onClick={startVoiceCall}
                  disabled={callStatus !== "idle"}
                  className="p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors disabled:opacity-50"
                >
                  <Phone className="w-5 h-5" />
                </button>
                <button
                  onClick={startVideoCall}
                  disabled={callStatus !== "idle"}
                  className="p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors disabled:opacity-50"
                >
                  <Video className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.type === "customer" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] px-4 py-2 rounded-lg ${
                msg.type === "customer"
                  ? isDarkMode ? "bg-blue-600" : "bg-blue-500 text-white"
                  : msg.type === "system"
                  ? isDarkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-600"
                  : isDarkMode ? "bg-slate-700 text-slate-100" : "bg-white text-slate-800 border border-slate-200"
              }`}
            >
              {msg.isVoice ? (
                <div className="flex items-center gap-2">
                  <Mic className="w-4 h-4" />
                  <span>Spraakbericht</span>
                </div>
              ) : (
                <p>{msg.text}</p>
              )}
              <p className="text-xs opacity-70 mt-1">
                {new Date(msg.timestamp).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
        ))}
        {operatorTyping && (
          <div className="flex justify-start">
            <div className={`${isDarkMode ? "bg-slate-700" : "bg-slate-100"} px-4 py-2 rounded-lg text-sm ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
              Operator typt...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className={`border-t ${isDarkMode ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"} p-4`}>
        <div className="flex gap-2">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
            placeholder="Typ je bericht..."
            className={`flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              isDarkMode
                ? "bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400"
                : "bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400"
            }`}
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputMessage.trim()}
            className={`p-2 rounded-lg transition-colors ${
              isDarkMode
                ? "bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700"
                : "bg-blue-500 hover:bg-blue-600 disabled:bg-slate-300"
            } text-white`}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
