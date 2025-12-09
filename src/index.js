// quick_openrouter_check.js
// Run with: node quick_openrouter_check.js

const KEY = "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"; // <— replace with your actual key

async function checkKey() {
  const res = await fetch("https://api.openrouter.ai/v1/models", {
    headers: { Authorization: `Bearer ${KEY}` }
  });

  console.log("Status:", res.status);
  if (res.ok) {
    const data = await res.json();
    console.log("✅ Key works! Models available:", data.data.length);
  } else {
    const text = await res.text();
    console.log("❌ Key invalid or error:", text);
  }
}

checkKey();
