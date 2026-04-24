#!/bin/bash
# Report GPU and CPU temperatures; append reading to CSV for trend tracking.
# Run directly for a quick summary, or called by homelab-health-data.sh.

LOG_DIR="/var/log/homelab"
LOG_FILE="$LOG_DIR/temps.csv"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
LOCAL_TIME=$(date '+%Y-%m-%d %H:%M %Z')

GPU_WARN=75
GPU_CRIT=85
CPU_WARN=75
CPU_CRIT=85

# --- GPU temps via nvidia-smi ---
gpu_data=$(nvidia-smi --query-gpu=index,name,temperature.gpu --format=csv,noheader 2>/dev/null)
gpu0_temp=$(echo "$gpu_data" | awk -F', ' 'NR==1{print $3}')
gpu1_temp=$(echo "$gpu_data" | awk -F', ' 'NR==2{print $3}')

# --- CPU temp: try sensors first, then hwmon sysfs ---
cpu_temp=""
if command -v sensors &>/dev/null; then
    cpu_temp=$(sensors 2>/dev/null \
        | grep -E "^(Package id 0|Tdie|Tctl|CPU Temperature)" \
        | grep -oP '\+\K[0-9]+' | head -1)
fi
if [ -z "$cpu_temp" ]; then
    for hwmon in /sys/class/hwmon/hwmon*; do
        name=$(cat "$hwmon/name" 2>/dev/null)
        if [[ "$name" == "k10temp" || "$name" == "coretemp" ]]; then
            t=$(cat "$hwmon/temp1_input" 2>/dev/null)
            if [ -n "$t" ] && [ "$t" -gt 0 ]; then
                cpu_temp=$((t / 1000))
                break
            fi
        fi
    done
fi

# --- Append to CSV ---
mkdir -p "$LOG_DIR"
if [ ! -f "$LOG_FILE" ]; then
    echo "timestamp,gpu0_c,gpu1_c,cpu_c" > "$LOG_FILE"
fi
echo "$TIMESTAMP,${gpu0_temp:-?},${gpu1_temp:-?},${cpu_temp:-?}" >> "$LOG_FILE"

# --- Status helper ---
status() {
    local v=$1 w=$2 c=$3
    [[ -z "$v" || "$v" == "?" ]] && echo "N/A" && return
    [ "$v" -ge "$c" ] 2>/dev/null && echo "**CRITICAL**" && return
    [ "$v" -ge "$w" ] 2>/dev/null && echo "WARN" && return
    echo "OK"
}

# --- Output markdown ---
echo "## GPU & CPU Temperatures — $LOCAL_TIME"
echo ""
echo "| Sensor | Temp °C | Status |"
echo "|--------|---------|--------|"
printf "| GPU 0 (RTX 3090) | %s | %s |\n" \
    "${gpu0_temp:-N/A}" "$(status "$gpu0_temp" $GPU_WARN $GPU_CRIT)"
printf "| GPU 1 (RTX 3090) | %s | %s |\n" \
    "${gpu1_temp:-N/A}" "$(status "$gpu1_temp" $GPU_WARN $GPU_CRIT)"
printf "| CPU               | %s | %s |\n" \
    "${cpu_temp:-N/A}" "$(status "$cpu_temp" $CPU_WARN $CPU_CRIT)"
echo ""
echo "Thresholds: WARN ≥ ${GPU_WARN}°C, CRITICAL ≥ ${GPU_CRIT}°C"
echo ""

# --- Trend: last 7 readings ---
line_count=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
if [ "$line_count" -gt 2 ]; then
    data_rows=$(( line_count - 1 ))
    show=$(( data_rows < 7 ? data_rows : 7 ))
    echo "### Recent Trend (last $show readings)"
    echo '```'
    printf "%-25s %-8s %-8s %s\n" "timestamp" "gpu0_c" "gpu1_c" "cpu_c"
    tail -n "$show" "$LOG_FILE" \
        | awk -F',' '{printf "%-25s %-8s %-8s %s\n", $1, $2, $3, $4}'
    echo '```'
fi
