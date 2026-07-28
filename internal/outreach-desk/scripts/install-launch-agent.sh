#!/bin/zsh
set -euo pipefail

ACTION="${1:-}"
LABEL="com.leveragedsystems.outreach-desk"
SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h:h:h}"
TEMPLATE_PATH="${PROJECT_ROOT}/internal/outreach-desk/launchd/${LABEL}.plist.template"
AGENT_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
DATA_DIRECTORY="${OUTREACH_DATA_DIR:-${HOME}/Library/Application Support/Leveraged Systems/Outreach Desk}"
LOG_DIRECTORY="${DATA_DIRECTORY}/logs"
NODE_PATH="$(command -v node)"
DOMAIN="gui/$(id -u)"

escape_sed() {
  print -r -- "$1" | sed 's/[&|]/\\&/g'
}

case "${ACTION}" in
  install)
    umask 077
    mkdir -p "${HOME}/Library/LaunchAgents" "${DATA_DIRECTORY}" "${LOG_DIRECTORY}"
    chmod 700 "${DATA_DIRECTORY}" "${LOG_DIRECTORY}"
    touch "${LOG_DIRECTORY}/outreach-desk.log" "${LOG_DIRECTORY}/outreach-desk.error.log"
    chmod 600 "${LOG_DIRECTORY}/outreach-desk.log" "${LOG_DIRECTORY}/outreach-desk.error.log"
    sed \
      -e "s|__NODE_PATH__|$(escape_sed "${NODE_PATH}")|g" \
      -e "s|__PROJECT_ROOT__|$(escape_sed "${PROJECT_ROOT}")|g" \
      -e "s|__DATA_DIRECTORY__|$(escape_sed "${DATA_DIRECTORY}")|g" \
      -e "s|__LOG_DIRECTORY__|$(escape_sed "${LOG_DIRECTORY}")|g" \
      "${TEMPLATE_PATH}" > "${AGENT_PATH}"
    chmod 600 "${AGENT_PATH}"
    launchctl bootout "${DOMAIN}" "${AGENT_PATH}" 2>/dev/null || true
    launchctl bootstrap "${DOMAIN}" "${AGENT_PATH}"
    print "Installed ${LABEL}. Data remains in ${DATA_DIRECTORY}."
    ;;
  uninstall)
    launchctl bootout "${DOMAIN}" "${AGENT_PATH}" 2>/dev/null || true
    if [[ -f "${AGENT_PATH}" ]]; then mv "${AGENT_PATH}" "${AGENT_PATH}.disabled"; fi
    print "Uninstalled ${LABEL}. Database, backups, and logs were preserved in ${DATA_DIRECTORY}."
    ;;
  *)
    print -u2 "Usage: ${0:t} install|uninstall"
    exit 2
    ;;
esac
