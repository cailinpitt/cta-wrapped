# Ventra Transit Scraper

A Node.js script to fetch and store your Ventra transit card usage history. Note this does not fetch Metra data.

## Overview

This script logs into your Ventra account and pulls your recent transaction history, storing it locally in a JSON file. It's designed to run periodically (e.g., weekly via cron) to build up a complete dataset of your transit usage throughout the year. Ventra's APIs only return up to 100 individual account usage events, which is why this script should be run periodically to capture your usage.

## How It Works

1. **Login** - Authenticates with your Ventra username and password
2. **Get Token** - Extracts the CSRF verification token from your account page
3. **Fetch Transactions** - Calls the Ventra API to retrieve your transaction history
4. **Merge & Deduplicate** - Adds only new transactions to your existing data file
5. **Clean & Filter** - Removes HTML tags from dates and filters out "Sale" transactions (when you add money to your card)

## Requirements

- Node.js 18+ (for built-in `fetch` API)
- A Ventra account

## Setup

Create a `keys.js` file in the same directory:
```javascript
module.exports = {
    ventraKeys: {
        username: 'your_ventra_username',
        password: 'your_ventra_password',
        transitAccountId: 'your_transit_account_id'
    }
};
```

## Usage

Run the script manually:
```bash
node ventra_scraper.js
```

Or set up a weekly cron job (runs every Sunday at 2 AM):
```bash
crontab -e
```

Add this line:
```
0 2 * * 0 cd /path/to/script && node ventra_scraper.js >> ventra_scraper.log 2>&1
```

## Output

The script creates/updates `ventra_transactions.json` with the following structure:
```json
{
  "transactions": [
    {
      "TransactionDateFormatted": "01/31/2026 9:40:59 AM",
      "AmountFormatted": "-$2.50",
      "TransactionType": "Use",
      "OperatorDesc": "CTA Rail",
      "LocationRoute": "Red-Thorndale",
      ...
    }
  ],
  "lastUpdated": "2026-01-31T12:00:00.000Z",
  "totalTransactions": 150
}
```

## Notes

- Only "Use" and "Transfer" transactions are stored. Sales (Ventra account reloads) are filtered out
- Duplicate transactions are automatically skipped
- Transactions are sorted by date (most recent first)