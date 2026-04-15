const fs = require('fs').promises;
const path = require('path');
const { ventraKeys } = require('./keys.js');
const { sendMail } = require('./mailer.js');
const { generateWrapped, emailWrapped, getWeekNumber } = require('./generate_wrapped.js');

const CONFIG = {
    maxRetries: 3,
    retryDelay: 5000,
};

class VentraAPI {
    constructor(username, password, transitAccountId) {
        this.baseUrl = 'https://www.ventrachicago.com';
        this.username = username;
        this.password = password;
        this.transitAccountId = transitAccountId;
        this.verificationToken = null;
        this.cookies = '';
    }

    /** Make HTTP request and capture cookies */
    request = async (url, options = {}) => {
        const response = await fetch(url, {
            ...options,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                ...options.headers
            }
        });

        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
            const newCookies = setCookie.split(',')
                .map(cookie => cookie.split(';')[0].trim())
                .join('; ');
            this.cookies = this.cookies ? `${this.cookies}; ${newCookies}` : newCookies;
        }

        return response;
    }

    /** Authenticate with Ventra */
    login = async () => {
        console.log('Logging in');
        
        const loginData = new URLSearchParams({
            'f': 'search',
            'u': this.username,
            'p': this.password,
            'pc': 'true',
            '__CALLBACKID': 'CT_Header$ccHeaderLogin',
            '__CALLBACKPARAM': '',
            '__EVENTTARGET': '',
            '__EVENTARGUMENT': ''
        });

        try {
            const response = await this.request(`${this.baseUrl}/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: loginData.toString(),
                redirect: 'manual'
            });

            const data = await response.text();

            if (data.includes('"success":true')) {
                console.log('Login successful');
                return true;
            } else {
                console.log('Login failed');
                return false;
            }
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    /** Extract CSRF verification token from account page */
    getVerificationToken = async () => {
        console.log('Getting verification token');

        try {
            const response = await this.request(`${this.baseUrl}/account/landing/`, {
                headers: {
                    'Cookie': this.cookies
                }
            });

            const html = await response.text();

            const match = html.match(/name="hdnRequestVerificationToken"[^>]*value="([^"]+)"/);

            if (match && match[1]) {
                this.verificationToken = match[1];
                return true;
            } else {
                console.log('Could not find verification token');
                return false;
            }
        } catch (error) {
            console.error('Token fetch error:', error);
            throw error;
        }
    }

    /** Fetch transaction history from API */
    getTransactionHistory = async () => {
        console.log(`Fetching transaction history`);

        const payload = {
            "s": 1,
            "MaxNumberOfRows": "100",
            "TransitAccountId": this.transitAccountId,
            "SelectedProduct": "",
            "SelectedTransactionType": "",
            "SelectedRange": 0,
            "Props": {
                "draw": 1,
                "columns": [
                    {"data": "TransactionDate", "name": "", "searchable": true, "orderable": true, "search": {"value": "", "regex": false}},
                    {"data": "TransactionDateFormatted", "name": "", "searchable": true, "orderable": true, "search": {"value": "", "regex": false}},
                    {"data": "TransactionType", "name": "", "searchable": true, "orderable": true, "search": {"value": "", "regex": false}},
                    {"data": "OperatorDesc", "name": "", "searchable": true, "orderable": true, "search": {"value": "", "regex": false}},
                    {"data": "LocationRoute", "name": "", "searchable": true, "orderable": true, "search": {"value": "", "regex": false}},
                    {"data": "ProductDesc", "name": "", "searchable": true, "orderable": true, "search": {"value": "", "regex": false}},
                    {"data": "Amount", "name": "", "searchable": true, "orderable": true, "search": {"value": "", "regex": false}},
                    {"data": "AmountFormatted", "name": "", "searchable": true, "orderable": true, "search": {"value": "", "regex": false}}
                ],
                "order": [{"column": 0, "dir": "desc"}],
                "start": 0,
                "length": -1,
                "search": {"value": "", "regex": false}
            }
        };

        try {
            const response = await this.request(
                `${this.baseUrl}/ajax/NAM.asmx/GetTransactionHistory`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'RequestVerificationToken': this.verificationToken,
                        'X-Requested-With': 'XMLHttpRequest',
                        'Referer': `${this.baseUrl}/account/transaction-history/`,
                        'Cookie': this.cookies
                    },
                    body: JSON.stringify(payload)
                }
            );

            if (response.ok) {
                console.log('Retrieved transit usage');
                return await response.json();
            } else {
                const text = await response.text();
                console.log(`Error retrieving transit usage ${response.status} Response: ${text}`);
                throw new Error(`HTTP ${response.status}: ${text}`);
            }
        } catch (error) {
            console.error('Retrieval error:', error);
            throw error;
        }
    }

    /** Execute full workflow: login, get token, fetch data */
    fetchAllData = async () => {
        if (!await this.login()) {
            throw new Error('Login failed');
        }

        await sleep(2000);

        if (!await this.getVerificationToken()) {
            throw new Error('Failed to get verification token');
        }

        await sleep(3000);

        return await this.getTransactionHistory();
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Retry wrapper for async functions */
const withRetry = async (fn, maxRetries = CONFIG.maxRetries, retryDelay = CONFIG.retryDelay) => {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Attempt ${attempt} of ${maxRetries}`);
            return await fn();
        } catch (error) {
            lastError = error;
            console.error(`Attempt ${attempt} failed:`, error.message);
            
            if (attempt < maxRetries) {
                console.log(`Waiting ${retryDelay / 1000} seconds before retry...`);
                await sleep(retryDelay);
            }
        }
    }
    
    throw new Error(`All ${maxRetries} attempts failed. Last error: ${lastError.message}`);
};

/** Generate unique key for deduplication */
const getTransactionKey = (transaction) => {
    return `${transaction.timestamp}_${transaction.transactionType}_${transaction.locationRoute}_${transaction.amount}`;
};

/** Load existing transactions from file */
const loadExistingData = async (dataFile) => {
    try {
        const content = await fs.readFile(dataFile, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.log("Error loading existing transactions:", error.message);
        return {
            transactions: [],
            lastUpdated: null,
            totalTransactions: 0
        };
    }
};

/** Transform raw transaction into clean format */
const cleanTransaction = (transaction) => {
    const timestamp = parseInt(transaction.TransactionDate.match(/\d+/)[0]);
    const formattedDate = transaction.TransactionDateFormatted
        .replace(/<br\/>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    const type = transaction.OperatorDesc && transaction.OperatorDesc.includes('Rail') ? 'Rail' : 'Bus';

    return {
        formattedDate,
        formattedAmount: transaction.AmountFormatted,
        timestamp,
        transactionType: transaction.TransactionType,
        type,
        locationRoute: transaction.LocationRoute,
        amount: transaction.Amount
    };
};

/** Merge new transactions with existing data, filtering duplicates and Sales */
const mergeTransactions = (existingData, newData) => {
    if (!newData || !newData.d || !newData.d.result || !newData.d.result.data) {
        console.log('No new data to merge');
        return {
            data: existingData,
            stats: { addedCount: 0, filteredCount: 0, newTransactions: [] }
        };
    }

    const newTransactions = newData.d.result.data;
    
    const existingKeys = new Set(
        existingData.transactions.map(t => getTransactionKey(t))
    );

    let addedCount = 0;
    let filteredCount = 0;
    const addedTransactions = [];
    
    for (const transaction of newTransactions) {
        if (transaction.TransactionType === 'Sale') {
            filteredCount++;
            continue;
        }

        const cleanedTransaction = cleanTransaction(transaction);
        const key = getTransactionKey(cleanedTransaction);
        
        if (!existingKeys.has(key)) {
            existingData.transactions.push(cleanedTransaction);
            addedTransactions.push(cleanedTransaction);
            existingKeys.add(key);
            addedCount++;
        }
    }

    existingData.transactions.sort((a, b) => b.timestamp - a.timestamp);

    existingData.lastUpdated = new Date().toISOString();
    existingData.totalTransactions = existingData.transactions.length;

    console.log(`Added ${addedCount} new transactions`);
    if (filteredCount > 0) {
        console.log(`Filtered out ${filteredCount} Sale transactions`);
    }
    console.log(`Total transactions: ${existingData.totalTransactions}`);

    return {
        data: existingData,
        stats: { addedCount, filteredCount, newTransactions: addedTransactions }
    };
};

/** Send last month's wrapped on the first run of a new month (any day in week 1) */
const maybeSendMonthlyWrapped = async () => {
    const today = new Date();
    if (today.getDate() > 7) return;

    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    try {
        const result = await generateWrapped(prev.getFullYear(), prev.getMonth() + 1);
        await emailWrapped(result);
    } catch (err) {
        console.error('Failed to generate monthly wrapped:', err.message);
    }
};

/** Generate the previous week's wrapped images for attachment */
const buildWeeklyAttachments = async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const year = yesterday.getFullYear();
    const week = getWeekNumber(yesterday);
    try {
        const result = await generateWrapped(year, null, week);
        if (!result) return { attachments: [], period: null };
        return {
            attachments: result.filePaths.map(p => ({ filename: path.basename(p), path: p })),
            period: result.period
        };
    } catch (err) {
        console.error('Failed to generate weekly wrapped:', err.message);
        return { attachments: [], period: null };
    }
};

/** Send email notification */
const sendEmail = async (stats, error = null) => {
    let subject, text, attachments = [];

    if (error) {
        subject = '❌ Ventra Scraper Error';
        text = `Ventra scraper encountered an error:\n\n${error}\n\nTime: ${new Date().toISOString()}`;
    } else {
        const { attachments: weeklyAttachments, period } = await buildWeeklyAttachments();
        attachments = weeklyAttachments;

        subject = stats.addedCount > 0
            ? `✅ Ventra Scraper: ${stats.addedCount} New Transaction${stats.addedCount !== 1 ? 's' : ''}`
            : '✅ Ventra Scraper: No New Transactions';

        let transactionDetails = '';
        if (stats.newTransactions.length > 0) {
            transactionDetails = '\n\nNew Transactions:\n' + stats.newTransactions.map(t =>
                `  • ${t.formattedDate} - ${t.type} - ${t.locationRoute} [${t.transactionType}]`
            ).join('\n');
        }

        const wrappedNote = period
            ? `\n\nWeekly wrapped attached: ${period}`
            : '\n\nNo wrapped generated (no transactions for the past week)';

        text = `Ventra scraper completed successfully!\n\n` +
               `Added: ${stats.addedCount} new transaction${stats.addedCount !== 1 ? 's' : ''}\n` +
               `Filtered: ${stats.filteredCount} Sale transaction${stats.filteredCount !== 1 ? 's' : ''}\n` +
               `Total: ${stats.totalTransactions} transactions in database\n` +
               `Time: ${new Date().toISOString()}` +
               transactionDetails +
               wrappedNote;
    }

    await sendMail({ subject, text, attachments });
};

const main = async () => {
    const username = ventraKeys.username;
    const password = ventraKeys.password;
    const transitAccountId = ventraKeys.transitAccountId;
    const dataFile = 'ventra_transactions.json';

    console.log(`[${new Date().toISOString()}] Starting Ventra data fetch`);

    const ventra = new VentraAPI(username, password, transitAccountId);

    try {
        const newData = await withRetry(() => ventra.fetchAllData());

        const existingData = await loadExistingData(dataFile);
        const { data: mergedData, stats } = mergeTransactions(existingData, newData);
        
        await fs.writeFile(
            dataFile,
            JSON.stringify(mergedData, null, 2),
            'utf-8'
        );

        console.log(`Data saved to ${dataFile}`);
        console.log(`[${new Date().toISOString()}] Complete`);

        await sendEmail({
            ...stats,
            totalTransactions: mergedData.totalTransactions
        });

        await maybeSendMonthlyWrapped();

    } catch (error) {
        console.error(`[${new Date().toISOString()}] - Error:`, error);
        await sendEmail(null, error.message);
    }
};

if (require.main === module) {
    main();
}
