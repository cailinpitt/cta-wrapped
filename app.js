const fs = require('fs').promises;
const { ventraKeys, email } = require('./keys.js');
const nodemailer = require('nodemailer');

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
            console.error('Login error:', error.message);
            return false;
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
            console.error('Token fetch error:', error.message);
            return false;
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
                console.log(`Error retrieving transit usage ${response} Response: ${text}`);
                return null;
            }
        } catch (error) {
            console.error('Retrieval error:', error.message);
            return null;
        }
    }

    /** Execute full workflow: login, get token, fetch data */
    fetchAllData = async () => {
        if (!await this.login()) {
            return null;
        }

        if (!await this.getVerificationToken()) {
            return null;
        }

        return await this.getTransactionHistory();
    }
}

/** Generate unique key for deduplication */
const getTransactionKey = (transaction) => {
    return `${transaction.TransactionDate}_${transaction.TransactionType}_${transaction.LocationRoute}_${transaction.Amount}`;
};

/** Load existing transactions from file */
const loadExistingData = async (dataFile) => {
    try {
        const content = await fs.readFile(dataFile, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        return {
            transactions: [],
            lastUpdated: null,
            totalTransactions: 0
        };
    }
};

/** Clean transaction data (remove HTML, normalize spacing) */
const cleanTransaction = (transaction) => {
    return {
        ...transaction,
        TransactionDateFormatted: transaction.TransactionDateFormatted
            .replace(/<br\/>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
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
        
        const key = getTransactionKey(transaction);
        if (!existingKeys.has(key)) {
            const cleanedTransaction = cleanTransaction(transaction);
            existingData.transactions.push(cleanedTransaction);
            addedTransactions.push(cleanedTransaction);
            existingKeys.add(key);
            addedCount++;
        }
    }

    existingData.transactions.sort((a, b) => {
        const dateA = parseInt(a.TransactionDate.match(/\d+/)[0]);
        const dateB = parseInt(b.TransactionDate.match(/\d+/)[0]);
        return dateB - dateA;
    });

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

/** Send email notification */
const sendEmail = async (stats, error = null) => {
    const emailConfig = email;
    
    if (!emailConfig) {
        console.log('No email configuration found, skipping notification');
        return;
    }

    const transporter = nodemailer.createTransport({
        service: emailConfig.service,
        auth: {
            user: emailConfig.user,
            pass: emailConfig.password
        }
    });

    let subject, text;

    if (error) {
        subject = '❌ Ventra Scraper Error';
        text = `Ventra scraper encountered an error:\n\n${error}\n\nTime: ${new Date().toISOString()}`;
    } else {
        subject = stats.addedCount > 0 
            ? `✅ Ventra Scraper: ${stats.addedCount} New Transaction${stats.addedCount !== 1 ? 's' : ''}`
            : '✅ Ventra Scraper: No New Transactions';

        let transactionDetails = '';
        if (stats.newTransactions.length > 0) {
            transactionDetails = '\n\nNew Transactions:\n' + stats.newTransactions.map(t => 
                `  • ${t.TransactionDateFormatted} - ${t.TransactionType} - ${t.LocationRoute} - ${t.AmountFormatted}`
            ).join('\n');
        }

        text = `Ventra scraper completed successfully!\n\n` +
               `Added: ${stats.addedCount} new transaction${stats.addedCount !== 1 ? 's' : ''}\n` +
               `Filtered: ${stats.filteredCount} Sale transaction${stats.filteredCount !== 1 ? 's' : ''}\n` +
               `Total: ${stats.totalTransactions} transactions in database\n` +
               `Time: ${new Date().toISOString()}` +
               transactionDetails;
    }

    try {
        await transporter.sendMail({
            from: emailConfig.user,
            to: emailConfig.to || emailConfig.user,
            subject: subject,
            text: text
        });
        console.log('Email notification sent');
    } catch (emailError) {
        console.error('Failed to send email:', emailError.message);
    }
};

const main = async () => {
    const DATA_FILE = 'ventra_transactions.json';
    
    const username = ventraKeys.username;
    const password = ventraKeys.password;
    const transitAccountId = ventraKeys.transitAccountId;

    console.log(`[${new Date().toISOString()}] Starting Ventra data fetch`);

    const ventra = new VentraAPI(username, password, transitAccountId);

    try {
        const newData = await ventra.fetchAllData();

        if (!newData) {
            const errorMsg = 'No data retrieved';
            console.log(`[${new Date().toISOString()}] - ${errorMsg}`);
            await sendEmail(null, errorMsg);
            return;
        }

        const existingData = await loadExistingData(DATA_FILE);
        const { data: mergedData, stats } = mergeTransactions(existingData, newData);
        
        await fs.writeFile(
            DATA_FILE,
            JSON.stringify(mergedData, null, 2),
            'utf-8'
        );

        console.log(`Data saved to ${DATA_FILE}`);
        console.log(`[${new Date().toISOString()}] Complete`);

        await sendEmail({
            ...stats,
            totalTransactions: mergedData.totalTransactions
        });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] - Error:`, error.message);
        await sendEmail(null, error.message);
    }
};

if (require.main === module) {
    main();
}

module.exports = { VentraAPI, mergeTransactions };