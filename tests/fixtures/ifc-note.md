---
Title: "Industry Foundation Classes (IFC)"
Aliases: ["IFC", "ISO 16739-1"]
Type: concept
Created: 2026-11-04
---

## Summary

SENTINEL-SUMMARY-WORD should never be stored.

```
## English in Action
- `fake-term` | Meaning: inside a code fence | Usage: "This fake-term must be ignored."
```

## English in Action

### Power Collocations & Terms
- `vendor-neutral` | Meaning: مستقل از فرمت اختصاصی هر نرم‌افزار | Usage: "IFC gives us a vendor-neutral way to share models with the contractor."
- `export mapping` | Meaning: جدول تبدیل عناصر نرم‌افزار به کلاس‌های IFC | Usage: "Could you share your IFC export mapping before the next model drop?"
- `schema version` | Meaning: نسخهٔ IFC که فایل بر اساس آن نوشته شده | Usage: "The schema version must be fixed in the BEP before the first delivery."
- `fit for purpose` | Meaning: مناسب برای کاربرد توافق‌شده | Usage: "The file opens, but it is not fit for purpose for clash detection yet."
- `model drop` | Meaning: تحویل دوره‌ای مدل در CDE | Usage: "We will review the structural model at the next model drop on Friday."

### Meeting Scenario
> [!quote] Context: جلسهٔ هماهنگی هفتگی؛ مدل سازه با تیرهای `Proxy` تحویل شده و `Clash Detection` نتیجهٔ درستی نداده است.
> **Structural Lead:** "We exported the IFC as usual. The model looks fine in our viewer."
> **You (Senior BIM Coordinator):** "It opens, but it isn't fit for purpose yet. All the beams came through as proxies, so the clash rules skip them. That points to the export mapping, not to the IFC format itself."
> **Structural Lead:** "So what do you need from us?"
> **You (Senior BIM Coordinator):** "Please update the export mapping, keep the schema version we agreed in the BEP, and send a test file before Friday's model drop. If the class check passes, we'll federate it straight away."

## Active Recall

> [!question] Recall
> - Q: SENTINEL-RECALL-WORD
