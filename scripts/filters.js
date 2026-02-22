export function roleMatches(title = "", description = "") {
  const text = (title + " " + description).toLowerCase();

  const positive = [
    "google ads",
    "ppc",
    "paid media",
    "performance marketing",
    "demand generation",
    "growth marketing",
    "crm",
    "marketing automation",
    "email marketing",
    "lifecycle marketing",
    "abm",
    "paid search",
    "digital marketing"
  ];

  const negative = [
    "content marketing",
    "seo specialist",
    "technical seo",
    "copywriter",
    "content writer",
    "community manager",
    "graphic designer",
    "video editor"
  ];

  const hasPositive = positive.some(k => text.includes(k));
  const hasNegative = negative.some(k => text.includes(k));

  return hasPositive && !hasNegative;
}

export function passesVisaOrRemote(location = "", description = "") {
  const text = (location + " " + description).toLowerCase();

  const rejectPatterns = [
    "remote - us only",
    "remote - uk only",
    "must be located",
    "must reside in",
    "us only",
    "uk only"
  ];

  if (rejectPatterns.some(p => text.includes(p))) {
    return false;
  }

  const acceptPatterns = [
    "remote",
    "worldwide",
    "work from anywhere",
    "global",
    "visa sponsorship",
    "sponsorship available",
    "relocation support"
  ];

  return acceptPatterns.some(p => text.includes(p));
}
