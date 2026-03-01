import { GoogleGenAI, Modality, ThinkingLevel, Type } from "@google/genai";
import { AuditReport, WaterMetric } from "../types";

export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
export { Modality, Type };

export async function generateVoiceGreeting(context?: string): Promise<string> {
  const prompt = context 
    ? `Say professionally and helpfully: Hello, I am your AquaAudit assistant. I've reviewed the water quality for ${context}. I'm here to help you understand these risks and find the right filtration solutions. What would you like to know?`
    : `Say cheerfully and professionally: Hello, I am your AquaAudit assistant. I can help you understand your water quality report and find the best filtration solutions for your home. How can I assist you today?`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
}

export async function analyzeWaterQuality(data: Record<string, string>): Promise<AuditReport> {
  const prompt = `
    Act as a Senior Water Quality Auditor.
    Analyze the following water quality test results provided by a consumer's home test kit.
    Results: ${JSON.stringify(data)}
    
    CRITICAL REQUIREMENTS:
    1. COMPARATIVE ANALYSIS: Compare findings against BOTH EPA Legal Limits and EWG Health Guidelines.
    2. CALCULATE RISK: For each contaminant, calculate how many "times" it exceeds the EWG Health Guideline.
    
    Return the response in JSON format matching this structure:
    {
      "overallScore": number (0-100),
      "summary": "string summary of findings",
      "metrics": [
        {
          "name": "string",
          "value": number,
          "unit": "string",
          "limit": number (EPA limit),
          "healthGuideline": number (EWG Health Guideline),
          "timesExceeded": number (value / healthGuideline),
          "description": "brief explanation of health risks",
          "status": "safe" | "warning" | "danger"
        }
      ],
      "recommendations": ["Specific filter types or actions"],
      "lastUpdated": "ISO string"
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
    },
  });

  return JSON.parse(response.text || "{}");
}

export async function getLocalWaterReport(location: string): Promise<AuditReport> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `
      Act as a Senior Water Quality Auditor. 
      Retrieve and synthesize RAW WATER QUALITY DATA for the location/zip code: ${location}.
      
      PRIMARY SOURCES TO AUDIT:
      1. EWG Tap Water Database (https://www.ewg.org/tapwater/)
      2. EPA ECHO & SDWIS
      
      CRITICAL REQUIREMENTS:
      1. DATA-DRIVEN: Provide specific contaminant concentrations.
      2. COMPARATIVE ANALYSIS: Compare findings against BOTH EPA Legal Limits and EWG Health Guidelines.
      3. CALCULATE RISK: For each contaminant, calculate how many "times" it exceeds the EWG Health Guideline.
      
      Return the response in JSON format matching this structure:
      {
        "overallScore": number (0-100, where 100 is perfectly safe),
        "summary": "Brief, consumer-friendly summary of the water quality in this area.",
        "utilityName": "Name of the water utility provider",
        "populationServed": "Number of people served",
        "metrics": [
          {
            "name": "Contaminant Name",
            "value": number,
            "unit": "ppb/mgL/etc",
            "limit": number (EPA Legal Limit),
            "healthGuideline": number (EWG Health Guideline),
            "timesExceeded": number (value / healthGuideline),
            "description": "Simple explanation of what this is and its health risks.",
            "status": "safe" | "warning" | "danger"
          }
        ],
        "recommendations": ["Specific filter types or actions"],
        "lastUpdated": "ISO string"
      }
    `,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
    },
  });

  return JSON.parse(response.text || "{}");
}
