const fs = require('fs').promises;
const { ventraKeys } = require('./keys.js');

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

    /** Extract CSRF token from account page so request to retrieve account history can be authenticated */
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

    /** Fetch recent transit usage history from API */
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

const getTransactionKey = (transaction) => {
    return `${transaction.TransactionDate}_${transaction.TransactionType}_${transaction.LocationRoute}_${transaction.Amount}`;
};

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

const cleanTransaction = (transaction) => {
    // Remove HTML tags from the formatted date and clean up extra spaces
    return {
        ...transaction,
        TransactionDateFormatted: transaction.TransactionDateFormatted
            .replace(/<br\/>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    };
};

const mergeTransactions = (existingData, newData) => {
    if (!newData || !newData.d || !newData.d.result || !newData.d.result.data) {
        console.log('No new data to merge');
        return existingData;
    }

    const newTransactions = newData.d.result.data;
    
    // Create a Set of existing transaction keys for fast lookup
    const existingKeys = new Set(
        existingData.transactions.map(t => getTransactionKey(t))
    );

    let addedCount = 0;
    let filteredCount = 0;
    
    for (const transaction of newTransactions) {
        // Filter out Sale transactions (Ventra account reloads)
        if (transaction.TransactionType === 'Sale') {
            filteredCount++;
            continue;
        }
        
        const key = getTransactionKey(transaction);
        if (!existingKeys.has(key)) {
            existingData.transactions.push(cleanTransaction(transaction));
            existingKeys.add(key);
            addedCount++;
        }
    }

    // Sort by date (most recent first)
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

    return existingData;
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
            console.log(`[${new Date().toISOString()}] - No data retrieved`);
            return;
        }

        const existingData = await loadExistingData(DATA_FILE);
        const mergedData = mergeTransactions(existingData, newData);
        await fs.writeFile(
            DATA_FILE,
            JSON.stringify(mergedData, null, 2),
            'utf-8'
        );

        console.log(`Data saved to ${DATA_FILE}`);
        console.log(`[${new Date().toISOString()}] Complete`);

    } catch (error) {
        console.error(`[${new Date().toISOString()}] - Error:`, error.message);
    }
};

main();
