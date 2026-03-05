"use client";

import { useState, useRef, useEffect } from "react";
import { Phone, Users, AlertTriangle, CheckCircle, UserCheck, RotateCcw, FileText, X } from "lucide-react";
import { io, Socket } from "socket.io-client";
import AIAnalysisPanel from "@/components/AIAnalysisPanel";
import InternalChat from "@/components/InternalChat";
import SpecialistsPanel from "@/components/SpecialistsPanel";
import {
  ConversationTabs,
  ChatMessages,
  ChatInput,
  VoiceCallOverlay,
  VideoCallOverlay,
} from "@/components/chat";
import { ConversationAnalysis, Specialist, Message } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/contexts/ChatContext";

const demoSpecialists: Specialist[] = [
  { id: "spec-1", name: "Dr. Jansen", expertise: ["Crisis", "Depressie"], status: "online", isAvailable: true },
  { id: "spec-2", name: "Dr. van Dijk", expertise: ["PTSS", "Trauma"], status: "online", isAvailable: true },
  { id: "spec-3", name: "Dr. Bakker", expertise: ["Jongeren"], status: "busy", isAvailable: false },
];

// Local type definitions
interface IncomingCall {
  id: string;
  customerName: string;
  phoneNumber: string;
  waitingSince: string;
}

interface IncomingChat {
  id: string;
  customerName: string;
  message: string;
  timestamp: string;
}

export default function Dashboard() {
  const { operator, setStatus, status } = useAuth();
  const [inputMessage, setInputMessage] = useState("");

  // WebSocket state
  const [socket, setSocket] = useState<Socket | null>(null);
  const getWSUrl = () => {
    if (typeof window === "undefined") return "http://localhost:3002";

    // Cloudflare tunnel support - gebruik specifieke URL
    const hostname = window.location.hostname;

    // Als we op trycloudflare.com zitten, gebruik de juiste WebSocket tunnel URL
    if (hostname.includes('trycloudflare.com')) {
      // De WebSocket heeft zijn eigen tunnel URL
      return "https://regularly-pavilion-cattle-office.trycloudflare.com";
    }

    // Lokale ontwikkeling
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    return `${protocol}//${hostname}:3002`;
  };
  const WS_URL = process.env.NEXT_PUBLIC_WS_URL || getWSUrl();

  // Voice and Video call states
  const [isVoiceCallActive, setIsVoiceCallActive] = useState(false);
  const [isVideoCallActive, setIsVideoCallActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  // Incoming call request from customer (before WebRTC is established)
  const [incomingCallRequest, setIncomingCallRequest] = useState<{ customerId: string; type: "audio" | "video" } | null>(null);

  // Track unread messages per conversation
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  // Redirect if not logged in
  if (!operator) {
    return null;
  }

  const {
    conversations,
    selectedConversation,
    selectConversation,
    updateConversation,
    removeConversation,
    addMessageToConversation,
    globalAISeverity,
    setGlobalAISeverity,
  } = useChat();

  // Dropdown states
  const [showCompletedDropdown, setShowCompletedDropdown] = useState(false);
  const [showReferredDropdown, setShowReferredDropdown] = useState(false);

  // Modal state for send note confirmation
  const [showSendNote, setShowSendNote] = useState<string | null>(null);

  const completedDropdownRef = useRef<HTMLDivElement>(null);
  const referredDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (completedDropdownRef.current && !completedDropdownRef.current.contains(event.target as Node)) {
        setShowCompletedDropdown(false);
      }
      if (referredDropdownRef.current && !referredDropdownRef.current.contains(event.target as Node)) {
        setShowReferredDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Connect to WebSocket
  useEffect(() => {
    if (!operator) return;

    const newSocket = io(WS_URL, {
      query: {
        name: operator.name,
        type: "operator",
        id: operator.id,
      },
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 2000,
      timeout: 10000,
      // Gebruik alleen polling voor Cloudflare tunnels (websocket upgrade werkt niet altijd)
      transports: ["polling"],
    });

    newSocket.on("connect", () => {
      console.log("Dashboard connected to WebSocket");
    });

    newSocket.on("message", (data: Message & { customerId: string; customerName: string }) => {
      addMessageToConversation(data.customerId, {
        id: data.id,
        type: data.type,
        senderId: data.customerId,
        senderName: data.customerName,
        text: data.text,
        timestamp: data.timestamp,
      });

      if (selectedConversation !== data.customerId) {
        setUnreadCounts(prev => ({
          ...prev,
          [data.customerId]: (prev[data.customerId] || 0) + 1
        }));
      }
    });

    newSocket.on("customer_typing", (data: { customerId: string; isTyping: boolean }) => {
      updateConversation(data.customerId, { customerTyping: data.isTyping });
    });

    newSocket.on("call_accepted", async (data: { answer: RTCSessionDescriptionInit }) => {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });

    newSocket.on("ice_candidate", async (data: { candidate: RTCIceCandidateInit }) => {
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error("Error adding ICE candidate:", e);
        }
      }
    });

    newSocket.on("call_ended", () => {
      handleEndVoiceCall();
      handleEndVideoCall();
    });

    // Handle call request from customer (customer clicks call button)
    newSocket.on("call_requested", (data: { customerId: string; customerName: string; type: "audio" | "video" }) => {
      console.log("[Dashboard] Call requested from customer:", data.customerId, data.type);
      // Store the incoming call request
      setIncomingCallRequest({ customerId: data.customerId, type: data.type });
      // Show notification to operator
      alert(`Klant ${data.customerName} vraagt om een ${data.type === "video" ? "video-oproep" : "spraakoproep"}. Klik op de oproepknop om op te nemen.`);
    });

    // Handle incoming call from customer (WebRTC offer from customer)
    newSocket.on("incoming_call", async (data: { operatorId: string; operatorName: string; offer: RTCSessionDescriptionInit; type: "audio" | "video" }) => {
      console.log("[Dashboard] Incoming WebRTC call from customer:", data.type);
      // The customer has already sent a WebRTC offer - we need to handle this
      // For now, show a notification to the operator
      alert(`Inkomende ${data.type === "video" ? "video-oproep" : "spraakoproep"} van klant. Klik op de oproepknop om op te nemen.`);
    });

    // Listen for incoming call request from Sidebar (via window event)
    const handleIncomingCallRequest = (event: Event) => {
      const customEvent = event as CustomEvent;
      const data = customEvent.detail;
      console.log("[Dashboard] Received incoming call request from Sidebar:", data);
      if (data && data.customerId) {
        setIncomingCallRequest({ customerId: data.customerId, type: data.type });
        // Show notification
        alert(`Klant ${data.customerName} vraagt om een ${data.type === "video" ? "video-oproep" : "spraakoproep"}.`);
      }
    };
    window.addEventListener("incoming-call-request", handleIncomingCallRequest);

    setSocket(newSocket);

    return () => {
      newSocket.close();
      window.removeEventListener("incoming-call-request", handleIncomingCallRequest);
    };
  }, [operator?.id]);

  const activeConversation = conversations.find(c => c.id === selectedConversation);

  const handleSelectConversation = (conversationId: string | null) => {
    if (conversationId) {
      setUnreadCounts(prev => ({
        ...prev,
        [conversationId]: 0
      }));
    }
    selectConversation(conversationId);
  };

  // Cleanup call timer on unmount
  useEffect(() => {
    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
    };
  }, []);

  // Handle incoming call request - auto select conversation
  useEffect(() => {
    if (incomingCallRequest) {
      // Check if we have a conversation with this customer
      const existingConversation = conversations.find(c => c.id === incomingCallRequest.customerId);
      if (existingConversation) {
        // Select this conversation
        handleSelectConversation(incomingCallRequest.customerId);
        // Clear the request
        setIncomingCallRequest(null);
      }
    }
  }, [incomingCallRequest, conversations]);

  // Reset call states when conversation changes
  useEffect(() => {
    setIsVoiceCallActive(false);
    setIsVideoCallActive(false);
    setIsMuted(false);
    setIsCameraOff(false);
    setCallDuration(0);
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
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
  }, [selectedConversation]);

  // Handle call timer - separate useEffect to avoid render-time updates
  useEffect(() => {
    if (isVoiceCallActive || isVideoCallActive) {
      callTimerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);

      // Update conversation call status
      if (activeConversation) {
        const callStatus = isVoiceCallActive ? "voice" : "video";
        updateConversation(activeConversation.id, { callStatus, callDuration: 0 });
      }

      return () => {
        if (callTimerRef.current) {
          clearInterval(callTimerRef.current);
          callTimerRef.current = null;
        }
      };
    }
  }, [isVoiceCallActive, isVideoCallActive, activeConversation?.id]);

  // Update call duration in conversation
  useEffect(() => {
    if ((isVoiceCallActive || isVideoCallActive) && activeConversation && callDuration > 0) {
      updateConversation(activeConversation.id, { callDuration });
    }
  }, [callDuration, isVoiceCallActive, isVideoCallActive, activeConversation?.id]);

  const liveConversations = conversations.filter(c => c.status === "live");

  const handleEndConversation = (convId: string, endType: "completed" | "missed" | "referred", specialistName?: string) => {
    const updates: Parameters<typeof updateConversation>[1] = {
      status: endType === "missed" ? "missed" : endType === "referred" ? "referred" : "ended",
    };
    if (endType === "referred") {
      updates.specialistName = specialistName;
      updates.specialistStatus = "live";
    }
    updateConversation(convId, updates);

    if (selectedConversation === convId) {
      selectConversation(null);
    }
    const remainingLive = conversations.filter(c => c.status === "live" && c.id !== convId).length;
    if (remainingLive === 0) {
      setStatus?.("online");
    }
  };

  // Typing indicator state
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleTyping = () => {
    if (!socket || !selectedConversation) return;

    if (!isTyping) {
      setIsTyping(true);
      socket.emit("typing", { customerId: selectedConversation, isTyping: true });
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      socket.emit("typing", { customerId: selectedConversation, isTyping: false });
    }, 2000);
  };

  const handleSendMessage = (text: string) => {
    if (!text.trim() || !selectedConversation) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      type: "operator",
      senderId: operator?.id || "op-1",
      senderName: operator?.name || "Jij",
      text: text.trim(),
      timestamp: new Date().toISOString(),
    };

    addMessageToConversation(selectedConversation, newMessage);

    if (socket) {
      socket.emit("operator_message", {
        customerId: selectedConversation,
        text: text.trim(),
      });
    }

    setIsTyping(false);
    if (socket) {
      socket.emit("typing", { customerId: selectedConversation, isTyping: false });
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    setInputMessage("");
  };

  const handleSendVoiceMessage = (audioBase64: string, duration: number) => {
    if (!selectedConversation) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      type: "operator",
      senderId: operator?.id || "op-1",
      senderName: operator?.name || "Jij",
      text: "🎤 Spraakbericht",
      timestamp: new Date().toISOString(),
      isVoice: true,
      audioData: audioBase64,
      voiceDuration: duration,
    };

    addMessageToConversation(selectedConversation, newMessage);

    if (socket) {
      socket.emit("operator_message", {
        customerId: selectedConversation,
        text: "🎤 Spraakbericht",
        isVoice: true,
        audioData: audioBase64,
        voiceDuration: duration,
      });
    }
  };

  // Voice Call handlers with WebRTC
  const createPeerConnection = (customerId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.ontrack = (event) => {
      remoteStreamRef.current = event.streams[0];
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit("webrtc_ice_candidate", {
          customerId,
          candidate: event.candidate,
        });
      }
    };

    return pc;
  };

  const handleStartVoiceCall = async () => {
    if (!activeConversation || !socket) return;

    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      const isHttps = window.location.protocol === "https:";

      if (!isLocalhost && !isHttps) {
        alert("Spraakoproepen vereisen een beveiligde verbinding (HTTPS) of localhost.\n\nOpties:\n1. Gebruik http://localhost:3000 (lokaal)\n2. Gebruik HTTPS met een geldig certificaat\n3. Zet de browser permissies voor deze site aan");
        return;
      }

      alert("Je browser ondersteunt geen spraakoproepen in deze context.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      const pc = createPeerConnection(activeConversation.id);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("webrtc_offer", {
        customerId: activeConversation.id,
        offer,
        type: "audio",
      });

      setIsVoiceCallActive(true);
      setCallDuration(0);
    } catch (err) {
      console.error("Error starting voice call:", err);
      alert("Kan geen toegang krijgen tot microfoon");
    }
  };

  const handleEndVoiceCall = () => {
    setIsVoiceCallActive(false);
    setIsMuted(false);

    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (socket && activeConversation) {
      socket.emit("end_call", { customerId: activeConversation.id });
      // Don't update conversation here - will be handled by socket event
    }

    setCallDuration(0);
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted((prev) => !prev);
    }
  };

  // Video Call handlers with WebRTC
  const handleStartVideoCall = async () => {
    if (!activeConversation || !socket) return;

    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      const isHttps = window.location.protocol === "https:";

      if (!isLocalhost && !isHttps) {
        alert("Video-oproepen vereisen een beveiligde verbinding (HTTPS) of localhost.\n\nOpties:\n1. Gebruik http://localhost:3000 (lokaal)\n2. Gebruik HTTPS met een geldig certificaat\n3. Zet de browser permissies voor deze site aan");
        return;
      }

      alert("Je browser ondersteunt geen video-oproepen in deze context.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const pc = createPeerConnection(activeConversation.id);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("webrtc_offer", {
        customerId: activeConversation.id,
        offer,
        type: "video",
      });

      setIsVideoCallActive(true);
      setCallDuration(0);
    } catch (err) {
      console.error("Error starting video call:", err);
      alert("Kan geen toegang krijgen tot camera/microfoon");
    }
  };

  const handleEndVideoCall = () => {
    setIsVideoCallActive(false);
    setIsMuted(false);
    setIsCameraOff(false);

    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }

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

    if (socket && activeConversation) {
      socket.emit("end_call", { customerId: activeConversation.id });
      // Don't update conversation here - will be handled by socket event
    }

    setCallDuration(0);
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsCameraOff((prev) => !prev);
    }
  };

  const completedConversations = conversations.filter(c => c.status === "ended");
  const referredConversations = conversations.filter(c => c.status === "referred");

  const demoAnalysis: ConversationAnalysis | undefined = activeConversation ? {
    sentiment: "negative",
    complianceScore: 90,
    responseTimeScore: 45,
    scriptAdherence: 88,
    escalationRecommended: false,
    severity: globalAISeverity,
    summary: `Gesprek met ${activeConversation.customerName}. Klant toont tekenen van bezorgdheid.`,
    suggestions: ["Valideer het gevoel", "Vraag naar coping mechanismen", "Overweeg doorverwijzing"],
    timestamp: new Date().toISOString(),
    aiRecommendation: "Doorverwijzing aanbevolen binnen 24-48 uur",
    recommendedSpecialist: demoSpecialists[0],
  } : undefined;

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-green-500 to-green-600 text-white p-3 rounded-xl shadow-sm mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-sm text-green-100">Welkom terug!</p>
              <h1 className="text-lg font-bold">{operator?.name || "Operator"} ({status === "online" ? "Online" : status === "busy" ? "In gesprek" : status})</h1>
            </div>

            <div className="flex items-center gap-2 ml-6">
              {/* Completed Dropdown */}
              <div className="relative" ref={completedDropdownRef}>
                <button
                  onClick={() => setShowCompletedDropdown(!showCompletedDropdown)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-sm font-medium">{completedConversations.length}</span>
                </button>
                {showCompletedDropdown && (
                  <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl shadow-lg border border-gray-200 z-50 max-h-80 overflow-y-auto">
                    <div className="p-3 border-b border-gray-200 flex items-center justify-between">
                      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-600" />
                        Afgeronde Gesprekken
                      </h3>
                      <button onClick={() => setShowCompletedDropdown(false)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="p-2 space-y-2">
                      {completedConversations.length === 0 ? (
                        <p className="text-gray-500 text-center py-4 text-sm">Geen afgeronde gesprekken</p>
                      ) : (
                        completedConversations.map(conv => (
                          <div key={conv.id} className="p-2 bg-gray-50 rounded-lg border border-gray-200">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-sm">{conv.customerName}</span>
                              <span className="text-xs text-gray-500">{new Date(conv.startTime).toLocaleTimeString()}</span>
                            </div>
                            <p className="text-xs text-gray-500">{conv.type === "call" ? "Telefoon" : "Chat"}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Referred Dropdown */}
              <div className="relative" ref={referredDropdownRef}>
                <button
                  onClick={() => setShowReferredDropdown(!showReferredDropdown)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/80 rounded-lg hover:bg-orange-500 transition-colors"
                >
                  <UserCheck className="w-4 h-4" />
                  <span className="text-sm font-medium">{referredConversations.length}</span>
                </button>
                {showReferredDropdown && (
                  <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl shadow-lg border border-gray-200 z-50 max-h-80 overflow-y-auto">
                    <div className="p-3 border-b border-gray-200 flex items-center justify-between">
                      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                        <UserCheck className="w-4 h-4 text-orange-600" />
                        Doorverwezen Gesprekken
                      </h3>
                      <button onClick={() => setShowReferredDropdown(false)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="p-2 space-y-2">
                      {referredConversations.length === 0 ? (
                        <p className="text-gray-500 text-center py-4 text-sm">Geen doorverwezen gesprekken</p>
                      ) : (
                        referredConversations.map(conv => (
                          <div key={conv.id} className="p-2 bg-orange-50 rounded-lg border border-orange-200">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-sm">{conv.customerName}</span>
                            </div>
                            <p className="text-xs text-gray-600">Specialist: {conv.specialistName}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-white/20 px-4 py-2 rounded-lg">
            <div className={`w-3 h-3 rounded-full ${status === "online" ? "bg-green-300 animate-pulse" : status === "busy" ? "bg-red-300" : "bg-gray-300"}`}></div>
            <span className="text-sm font-medium">{status === "online" ? "Klaar voor gesprekken" : status === "busy" ? "In gesprek" : status}</span>
          </div>
        </div>
      </div>

      {/* 4 Columns Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-0">

        {/* COLUMN 1: Active Chat */}
        <div className="bg-white border border-gray-200 rounded-xl flex flex-col min-h-0 relative">
          {/* Conversation Tabs */}
          <ConversationTabs
            conversations={liveConversations}
            selectedId={selectedConversation}
            unreadCounts={unreadCounts}
            isVoiceCallActive={isVoiceCallActive}
            isVideoCallActive={isVideoCallActive}
            onSelect={handleSelectConversation}
          />

          {activeConversation ? (
            <>
              <div className="p-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                <div>
                  <h3 className="font-semibold text-gray-900">{activeConversation.customerName}</h3>
                  <p className="text-xs text-gray-500">{activeConversation.customerNumber}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                    LIVE
                  </span>
                  <button onClick={() => handleEndConversation(activeConversation.id, "completed")} className="py-1 px-2 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition-colors">
                    Afronden
                  </button>
                </div>
              </div>

              {/* Chat Messages */}
              <ChatMessages
                messages={activeConversation.messages}
                customerName={activeConversation.customerName}
                isTyping={activeConversation.customerTyping || false}
              />

              {/* Voice Call Overlay */}
              {isVoiceCallActive && (
                <VoiceCallOverlay
                  customerName={activeConversation.customerName}
                  callDuration={callDuration}
                  isMuted={isMuted}
                  onToggleMute={toggleMute}
                  onEndCall={handleEndVoiceCall}
                  remoteStream={remoteStreamRef.current}
                />
              )}

              {/* Video Call Overlay */}
              {isVideoCallActive && (
                <VideoCallOverlay
                  customerName={activeConversation.customerName}
                  callDuration={callDuration}
                  isMuted={isMuted}
                  isCameraOff={isCameraOff}
                  localVideoRef={localVideoRef}
                  remoteVideoRef={remoteVideoRef}
                  onToggleMute={toggleMute}
                  onToggleCamera={toggleCamera}
                  onEndCall={handleEndVideoCall}
                />
              )}

              {/* Chat Input */}
              <ChatInput
                inputMessage={inputMessage}
                onInputChange={setInputMessage}
                onSend={handleSendMessage}
                onSendVoice={handleSendVoiceMessage}
                onTyping={handleTyping}
                onStartVoiceCall={handleStartVoiceCall}
                onStartVideoCall={handleStartVideoCall}
                isVoiceCallActive={isVoiceCallActive}
                isVideoCallActive={isVideoCallActive}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <p>Selecteer een gesprek</p>
            </div>
          )}
        </div>

        {/* COLUMN 2: AI Monitoring */}
        <div className="overflow-y-auto">
          <AIAnalysisPanel
            analysis={demoAnalysis}
            messages={activeConversation?.messages || []}
            severity={globalAISeverity}
            onSeverityChange={setGlobalAISeverity}
            conversationName={activeConversation?.customerName}
          />
        </div>

        {/* COLUMN 3: Specialists */}
        <div className="overflow-y-auto">
          <SpecialistsPanel
            specialists={demoSpecialists}
            onCall={(id) => {
              const spec = demoSpecialists.find(s => s.id === id);
              if (activeConversation && spec) {
                handleEndConversation(activeConversation.id, "referred", spec.name);
              }
            }}
            onSendNote={(id) => setShowSendNote(id)}
            aiRecommendation={demoAnalysis?.recommendedSpecialist}
          />
        </div>

        {/* COLUMN 4: Internal Chat */}
        <div className="overflow-y-auto">
          <InternalChat />
        </div>
      </div>
    </div>
  );
}
