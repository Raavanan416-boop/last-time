"""Fix double-encoded UTF-8 in script.js
The file has mojibake: UTF-8 bytes were misread as Windows-1252, then re-saved as UTF-8.
Fix: encode chars back through cp1252 to recover original UTF-8 bytes, then decode as UTF-8.
"""
import sys
import os

path = os.path.join(os.path.dirname(__file__), 'public', 'script.js')

with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

# Preserve line endings
line_ending = '\r\n' if '\r\n' in text else '\n'

try:
    # Encode back through cp1252 to recover original bytes, then decode as UTF-8
    fixed = text.encode('cp1252').decode('utf-8')
    
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(fixed)
    
    print(f"SUCCESS: Encoding fixed! File saved.")
    # Show a sample to verify
    for line_num, line in enumerate(fixed.split('\n'), 1):
        if any(keyword in line for keyword in ['joined the party', 'Live', 'Select a video', 'Mic On', 'textContent']):
            stripped = line.strip()
            if len(stripped) > 10 and not stripped.startswith('//') and not stripped.startswith('/*'):
                print(f"  Line {line_num}: {stripped[:100]}")
                
except UnicodeEncodeError as e:
    print(f"cp1252 encode error at position {e.start}: char {repr(text[e.start])}")
    # Fallback: fix what we can, skip what we can't
    result = []
    i = 0
    while i < len(text):
        try:
            b = text[i].encode('cp1252')
            result.append(b)
            i += 1
        except UnicodeEncodeError:
            # This char isn't in cp1252 - keep as-is (encode as UTF-8)
            result.append(text[i].encode('utf-8'))
            i += 1
    
    raw_bytes = b''.join(result)
    fixed = raw_bytes.decode('utf-8', errors='replace')
    
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(fixed)
    
    print("PARTIAL FIX applied (some chars may need manual review)")

except UnicodeDecodeError as e:
    print(f"UTF-8 decode error: {e}")
    print("File was NOT modified.")
