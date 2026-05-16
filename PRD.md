Product Requirements Document (PRD)

AI Customer Service Telegram Bot Platform

⸻

Overview

The product is a multi-tenant AI-powered customer service platform built around Telegram bots.

Businesses will be able to:

* Create and manage AI-powered Telegram support bots
* Upload company knowledge bases and internal documentation
* Configure AI behavior and response style
* Connect Telegram bots created via BotFather
* Allow customers to interact with AI support agents directly through Telegram
* Monitor conversations through a centralized dashboard
* Escalate conversations to human support agents
* Analyze support performance through analytics

The platform acts as an infrastructure layer for AI customer support on Telegram.

The system is not a single chatbot.

It is a configurable AI support platform where every company has isolated infrastructure, data, configuration, and knowledge.

⸻

Core Product Vision

The platform functions similarly to:

* Intercom
* Zendesk
* Crisp
* Drift

But specifically optimized around:

* Telegram
* AI-native support workflows
* Custom company knowledge retrieval
* Multi-tenant AI agent hosting
* Configurable AI agents

The goal is to abstract all AI complexity away from businesses.

Businesses should not need to understand:

* embeddings
* vector databases
* retrieval systems
* prompt engineering
* AI orchestration
* Telegram bot infrastructure

The platform handles everything.

⸻

High-Level System Architecture

[ Telegram ]
      ↓
[ Your Bot Gateway ]
      ↓
[ AI Agent Backend ]
      ↓
[ Knowledge + Config + Memory ]
      ↓
[ Dashboard / Admin Panel ]

⸻

Core System Components

1. Telegram Bot Layer

Each customer:

* Creates a Telegram bot using BotFather
* Receives a Telegram bot token
* Pastes the token into the platform dashboard

The platform:

* Registers Telegram webhooks
* Listens for incoming Telegram messages
* Routes messages to the correct workspace/company
* Sends AI-generated responses back to Telegram

⸻

Telegram Integration Requirements

The system must:

* Support webhook-based Telegram communication
* Avoid polling-based infrastructure
* Support scalable bot routing
* Handle simultaneous incoming messages
* Support multiple bots per organization in future versions

The platform should not process AI responses directly inside webhook handlers.

Instead:

Telegram Webhook
    ↓
API Gateway
    ↓
Queue
    ↓
AI Processing
    ↓
Store Response
    ↓
Send Telegram Reply

⸻

2. Multi-Tenant Backend Architecture

The platform must support isolated company workspaces.

Each workspace must contain:

Workspace
  ├── Bot Token
  ├── AI Settings
  ├── Knowledge Base
  ├── Conversations
  ├── Analytics
  ├── Human Agents
  └── Customer Data

Every company becomes a tenant.

Data isolation is critical.

The system must never allow:

Company A Data → Company B

⸻

Multi-Tenant Requirements

The system must support:

* Isolated organization data
* Organization-level configuration
* Role-based access control
* Per-company AI settings
* Per-company knowledge bases
* Per-company analytics
* Per-company conversation history
* Per-company support agents
* Separate billing support

⸻

3. AI Agent Service

The AI infrastructure should be separated from the main backend.

Recommended architecture:

Main Backend
    ├── Authentication
    ├── Dashboard APIs
    ├── Billing
    ├── Bot Configurations
    └── Webhooks
AI Agent Service
    ├── Retrieval
    ├── Embeddings
    ├── Memory
    ├── Prompt Assembly
    ├── Response Generation
    └── Tool Execution

This separation is important because:

* AI workloads scale differently
* AI inference costs scale differently
* Easier provider switching
* Easier infrastructure scaling
* Easier optimization
* Better system modularity

⸻

AI Agent Responsibilities

The AI service must:

* Accept user messages
* Retrieve relevant knowledge base context
* Build prompts dynamically
* Maintain memory
* Generate responses
* Handle escalations
* Support future tool usage
* Store AI reasoning metadata where needed
* Track confidence scores

⸻

AI Response Pipeline

Customer Message
      ↓
Workspace Identification
      ↓
Conversation Retrieval
      ↓
Knowledge Retrieval
      ↓
Prompt Construction
      ↓
LLM Response Generation
      ↓
Confidence Evaluation
      ↓
Escalation Check
      ↓
Response Delivery

⸻

4. Knowledge Base System

The knowledge base system is a core competitive advantage.

Businesses should be able to upload:

* PDFs
* DOCX files
* TXT files
* FAQ documents
* Product documentation
* Support manuals
* Website URLs
* Internal documentation

⸻

Knowledge Processing Pipeline

Upload
  ↓
Text Extraction
  ↓
Chunking
  ↓
Embedding Generation
  ↓
Vector Database Storage

⸻

Retrieval-Augmented Generation (RAG)

The system should use Retrieval-Augmented Generation.

Message flow:

User Message
  ↓
Embedding Search
  ↓
Relevant Company Context
  ↓
Prompt Assembly
  ↓
LLM Response

⸻

Knowledge Base Features

The platform should support:

* Document uploads
* Website crawling
* Document deletion
* Document updates
* Re-indexing
* Chunk management
* Metadata tagging
* Knowledge freshness controls
* Search visibility controls

⸻

Recommended Tech Stack

Frontend Dashboard

Recommended stack:

* React
* Vite
* Tailwind CSS
* ShadCN
* Zustand
* TanStack Query

The dashboard should prioritize:

* Speed
* Simplicity
* Realtime updates
* Inbox usability
* Operator experience

⸻

Backend Architecture

Recommended backend:

* NestJS
* PostgreSQL
* Prisma ORM
* BullMQ
* Redis

Reasons:

* Scalable architecture
* Modular structure
* Enterprise-grade organization
* Strong TypeScript ecosystem
* Good WebSocket support
* Excellent maintainability

⸻

AI Service Stack

Recommended AI service stack:

* Python
* FastAPI

Reasons:

* Better AI ecosystem
* Better document processing libraries
* Better embedding tooling
* Better orchestration tooling
* Strong LangChain ecosystem
* Strong LlamaIndex ecosystem

Recommended split:

Main Backend → NestJS
AI Agent Service → Python FastAPI

⸻

Vector Database Options

Potential vector database choices:

* Qdrant
* Pinecone
* Weaviate
* pgvector

Recommended:

* Qdrant

Reasons:

* Open source
* Fast
* Self-hostable
* Good filtering
* Cost-effective
* AI-focused architecture

⸻

Realtime Infrastructure

The platform requires strong realtime infrastructure.

Realtime features include:

* Live conversations
* AI response streaming
* Human takeover indicators
* Typing indicators
* Live inbox updates
* Notifications
* Active customer monitoring

⸻

Convex Evaluation

Convex is a strong option for:

* Realtime dashboard state
* Live inbox updates
* Conversation synchronization
* Realtime operator interfaces
* Subscription-based UI updates

Convex is especially strong for:

Conversations
Messages
Agent status
Typing indicators
Notifications
Live inbox updates

⸻

Convex Limitations

Convex should not be treated as:

* The vector database
* The AI orchestration layer
* The document processing engine

The platform will still require:

* External vector infrastructure
* Queue systems
* AI orchestration services
* Embedding pipelines
* Async processing systems

⸻

Convex Hybrid Architecture

Recommended hybrid architecture:

Frontend:
React + Next.js/Vite
Realtime App Layer:
Convex
AI Backend:
Python FastAPI
Vector DB:
Qdrant
Blob/File Storage:
S3/R2
LLM Providers:
OpenAI/Anthropic/Gemini/OpenRouter

⸻

Convex Usage Philosophy

Convex should be treated as:

Realtime application database

Not:

Complete AI infrastructure

⸻

Queue Infrastructure

The platform must support:

* Message queues
* Background jobs
* Retries
* Idempotency
* Rate limiting
* Burst handling

This is important because Telegram traffic may spike significantly.

Example:

500 companies
  ├── simultaneous support traffic
  ├── AI requests
  ├── human escalations
  └── concurrent webhooks

Recommended infrastructure:

* Redis
* BullMQ

⸻

Human Handoff System

Human escalation is a critical feature.

The AI alone is insufficient for production customer support.

Example flow:

Customer:
"I want to speak to a human"
AI detects escalation intent
    ↓
Conversation transferred
    ↓
Dashboard inbox
    ↓
Human support agent takeover

⸻

Human Handoff Requirements

The system should support:

* Manual takeover
* AI-triggered takeover
* Agent assignment
* Conversation locking
* Internal notes
* Tags
* Priority states
* Escalation reasons
* Agent availability

⸻

Dashboard Features

Workspace Settings

Organizations should configure:

* Telegram bot token
* AI personality
* Tone of voice
* Response behavior
* Escalation rules
* Support hours
* AI restrictions
* Allowed tools

⸻

Knowledge Base Dashboard

The dashboard should allow:

* File uploads
* Website crawling
* Document management
* Knowledge deletion
* Re-indexing
* Knowledge previews

⸻

Inbox System

The inbox should behave similarly to Intercom.

Features:

* Live conversations
* AI conversations
* Human takeover
* Tags
* Notes
* Search
* Customer history
* Status tracking
* Conversation assignment

⸻

Analytics Dashboard

The platform should support analytics including:

* Messages per day
* Resolution rate
* Escalation rate
* Response times
* AI confidence metrics
* Human takeover frequency
* Customer activity
* Conversation volume
* Agent performance

⸻

Memory System

The platform should support:

* Short-term memory
* Long-term memory

Example:

Customer:
"My order number is 4821"
Future messages:
AI remembers the order context

The system should store:

* Recent conversations
* Customer preferences
* Customer metadata
* Persistent context

⸻

Database Structure

Recommended core tables:

Users
Organizations
Bots
KnowledgeFiles
KnowledgeChunks
Conversations
Messages
Agents
Integrations
Billing

Additional future tables may include:

Escalations
AIResponses
PromptLogs
UsageLimits
Subscriptions
Workflows
AutomationRules

⸻

AI Prompt Structure

The platform should dynamically assemble prompts.

Example:

SYSTEM:
You are the AI support assistant for Company X.
RULES:
- only answer from knowledge base
- if unsure, escalate
- be concise
- never hallucinate pricing
CONTEXT:
[retrieved chunks]
CHAT HISTORY:
[last messages]
USER:
"How long is delivery?"

⸻

Hallucination Prevention

The platform must aggressively reduce hallucinations.

Recommended controls:

* Retrieval thresholds
* Confidence scoring
* Fallback responses
* Escalation triggers
* Knowledge relevance filtering
* “I don’t know” behaviors

⸻

Cost Optimization

LLM costs can scale rapidly.

The platform should support:

* Model routing
* Caching
* Message limits
* Workspace quotas
* Usage metering
* Tier-based AI access

Example:

Simple FAQ → cheaper model
Complex reasoning → advanced model

⸻

File Storage Infrastructure

The system should support external object storage.

Recommended:

* Cloudflare R2
* Amazon S3

Storage responsibilities:

* Uploaded documents
* Knowledge files
* Conversation attachments
* Logs
* Generated exports

⸻

Event-Driven Architecture

The platform should be event-driven.

Recommended event flow:

Telegram Webhook
    ↓
API Gateway
    ↓
Queue
    ↓
AI Processing
    ↓
Store Results
    ↓
Realtime Dashboard Update
    ↓
Telegram Reply

⸻

Multi-Agent Future Architecture

The platform should be designed to support future multi-agent systems.

Potential future agents:

Support Agent
Sales Agent
Booking Agent
FAQ Agent
Escalation Agent

Schema and orchestration systems should remain flexible.

⸻

Deployment Recommendations

Initial deployment recommendations:

Frontend:
Vercel
Backend:
Railway / Fly.io
AI Service:
Railway / Fly.io
Vector DB:
Qdrant Cloud / Self-hosted
Redis:
Upstash / Redis Cloud

⸻

Infrastructure Priorities

The platform architecture should prioritize:

* Scalability
* Isolation
* Realtime responsiveness
* AI flexibility
* Reliability
* Queue safety
* Fault tolerance
* Cost efficiency
* Extensibility

⸻

Monetization Strategy

Potential SaaS tiers:

Starter Plan

* 1 bot
* Limited monthly messages
* Basic AI support
* Basic analytics

⸻

Growth Plan

* Multiple bots
* Human handoff
* Advanced analytics
* More AI usage
* Team collaboration

⸻

Enterprise Plan

* Dedicated infrastructure
* API access
* Advanced integrations
* Custom AI models
* SLA support
* Dedicated onboarding

⸻

Competitive Advantage

The platform’s major advantage is abstraction.

Most businesses:

* Do not understand AI systems
* Do not understand embeddings
* Do not understand vector databases
* Do not understand Telegram infrastructure
* Do not understand prompt engineering

The platform abstracts all technical complexity.

⸻

Product Direction

The product should evolve beyond a chatbot.

Long-term direction:

AI Customer Support Platform
    ↓
AI Operations Layer
    ↓
AI Employee Infrastructure

Potential future capabilities:

* Ticket creation
* Order status checking
* Appointment scheduling
* Invoice generation
* CRM integration
* Workflow automation
* Agentic task execution

⸻

Final Recommended Stack

Frontend + Dashboard:
Next.js
Realtime Layer:
Convex
AI Backend:
Python FastAPI
Main Backend:
NestJS
Queues:
Redis + BullMQ
Vector Database:
Qdrant
Storage:
Cloudflare R2
LLM Providers:
OpenAI / Anthropic / Gemini / OpenRouter

⸻

Final Product Summary

The platform is a multi-tenant AI customer service infrastructure system for Telegram.

It combines:

* AI agents
* Knowledge retrieval
* Realtime dashboards
* Human escalation
* Configurable support behavior
* SaaS infrastructure
* AI orchestration
* Telegram integrations

The system is designed to evolve into a broader AI operations platform capable of supporting businesses through configurable AI workers and automation systems.