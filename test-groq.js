(async () => {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
      }
    });

    console.log("Status:", res.status);
    console.log(await res.text());
  } catch (e) {
    console.error("ERROR:", e.message);
  }
})();
