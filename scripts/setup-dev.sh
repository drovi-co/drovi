#!/bin/bash
# =============================================================================
# Drovi Development Environment Setup
# =============================================================================
# This script sets up the complete development environment including:
# - Environment files
# - Node.js dependencies
# - Docker infrastructure (PostgreSQL, FalkorDB)
# - Database schema
# - Python backend dependencies
#
# Usage:
#   ./scripts/setup-dev.sh
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║                    DROVI Development Setup                                ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# =============================================================================
# Step 1: Copy environment files
# =============================================================================
echo -e "${YELLOW}[1/6] Setting up environment files...${NC}"

if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}  ✓ Created .env from .env.example${NC}"
else
    echo -e "${BLUE}  ℹ .env already exists, skipping${NC}"
fi

if [ ! -f drovi-intelligence/.env ]; then
    cp drovi-intelligence/.env.example drovi-intelligence/.env
    echo -e "${GREEN}  ✓ Created drovi-intelligence/.env${NC}"
else
    echo -e "${BLUE}  ℹ drovi-intelligence/.env already exists, skipping${NC}"
fi

# =============================================================================
# Step 2: Install Node.js dependencies
# =============================================================================
echo -e "\n${YELLOW}[2/6] Installing Node.js dependencies...${NC}"

if command -v bun &> /dev/null; then
    bun install
    echo -e "${GREEN}  ✓ Node.js dependencies installed${NC}"
else
    echo -e "${RED}  ✗ Bun is not installed. Please install Bun first:${NC}"
    echo "    curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# =============================================================================
# Step 3: Start Docker infrastructure
# =============================================================================
echo -e "\n${YELLOW}[3/6] Starting Docker infrastructure...${NC}"

if command -v docker &> /dev/null; then
    docker compose -f docker-compose.dev.yml up -d
    echo -e "${GREEN}  ✓ Docker services started${NC}"
else
    echo -e "${RED}  ✗ Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

# =============================================================================
# Step 4: Wait for PostgreSQL to be ready
# =============================================================================
echo -e "\n${YELLOW}[4/6] Waiting for PostgreSQL to be ready...${NC}"

MAX_RETRIES=30
RETRY_COUNT=0

while ! docker exec drovi-dev-postgres pg_isready -U postgres -d memorystack > /dev/null 2>&1; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo -e "${RED}  ✗ PostgreSQL failed to start after $MAX_RETRIES attempts${NC}"
        exit 1
    fi
    echo -e "  Waiting for PostgreSQL... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done

echo -e "${GREEN}  ✓ PostgreSQL is ready${NC}"

# =============================================================================
# Step 5: Push database schema
# =============================================================================
echo -e "\n${YELLOW}[5/6] Pushing database schema...${NC}"

bun run db:push
echo -e "${GREEN}  ✓ Database schema pushed${NC}"

# =============================================================================
# Step 6: Install Python dependencies
# =============================================================================
echo -e "\n${YELLOW}[6/6] Installing Python dependencies...${NC}"

if [ -d "drovi-intelligence" ]; then
    cd drovi-intelligence

    if command -v uv &> /dev/null; then
        uv pip install -e .
        echo -e "${GREEN}  ✓ Python dependencies installed${NC}"
    elif command -v pip &> /dev/null; then
        pip install -e .
        echo -e "${GREEN}  ✓ Python dependencies installed (using pip)${NC}"
    else
        echo -e "${YELLOW}  ⚠ Neither uv nor pip found. Install Python dependencies manually:${NC}"
        echo "    cd drovi-intelligence && pip install -e ."
    fi

    cd ..
else
    echo -e "${YELLOW}  ⚠ drovi-intelligence directory not found, skipping Python setup${NC}"
fi

# =============================================================================
# Done!
# =============================================================================
echo -e "\n${GREEN}"
echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║                    Setup Complete!                                        ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "To start development, run these in separate terminals:\n"
echo -e "${BLUE}Terminal 1 - Web + Server:${NC}"
echo "  bun run dev"
echo ""
echo -e "${BLUE}Terminal 2 - Python AI Backend:${NC}"
echo "  cd drovi-intelligence && ./scripts/dev.sh"
echo ""
echo -e "${BLUE}Terminal 3 - Trigger.dev (background jobs):${NC}"
echo "  cd apps/server && bun run trigger:dev"
echo ""
echo -e "${YELLOW}Services available at:${NC}"
echo "  - Web App:         http://localhost:3001"
echo "  - API Server:      http://localhost:3000"
echo "  - Python Backend:  http://localhost:8000"
echo "  - FalkorDB UI:     http://localhost:3001"
echo "  - Mailpit:         http://localhost:8025"
echo ""
