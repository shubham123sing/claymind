"""ClayMind agent backend (Update 2, Step 2): optional AI helpers on top of the offline game.

FastAPI + Agno AgentOS. Agents: Helper (home), Researcher, Game Designer, Coach (LLM, free
Groq models through a quota governor), Kit Analyst and Referee (code). Keys only in the
server environment (server/.env). The game works without this backend.
"""
