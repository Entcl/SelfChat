import time
import hashlib

SECRET_KEY = "AdShield_Xiaomi_Secret_2026!"

def generate_activation_code(device_id, current_expire_sec=0, days=90):
    now_sec = int(time.time())
    if current_expire_sec > now_sec:
        base_time = current_expire_sec
    else:
        base_time = now_sec
    expire_sec = base_time + (days * 24 * 3600)
    payload = f"{device_id}|{expire_sec * 1000}"
    sign = hashlib.sha256((payload + SECRET_KEY).encode('utf-8')).hexdigest()[:8].upper()
    return f"{expire_sec}-{sign}"

# 微服务入口函数
def search(keyword):
    keyword = keyword.strip().upper()
    
    # 支持传入格式："设备ID" 或 "设备ID,原到期时间戳"
    parts = keyword.split(',')
    dev_id = parts[0]
    current_ts = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
    
    if len(dev_id) != 8:
        return f"❌ 生成失败：设备 ID '{dev_id}' 格式错误，必须是 8 位字符！"
        
    code = generate_activation_code(dev_id, current_ts)
    return f"✅ 设备 {dev_id} 的激活码：\n{code}"