import { doc, getDoc, setDoc, deleteDoc, getDocs, collection } from "firebase/firestore";
import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";

export const useFirestoreAuthState = async (db: any, collectionName: string) => {
    
    // Replace characters that Firestore doesn't allow in document IDs (like /)
    const fixId = (id: string) => id?.replace(/\//g, '__')?.replace(/:/g, '-');

    // Safely writes data to a Firestore document
    const writeData = async (data: any, id: string) => {
        try {
            const docRef = doc(db, collectionName, fixId(id));
            let serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
            
            // Firestore requires data to be an object. If it's a primitive or array, wrap it.
            if (serialized === null || typeof serialized !== 'object' || Array.isArray(serialized)) {
                serialized = { _data: serialized };
            }
            
            await setDoc(docRef, serialized);
        } catch (error) {
            console.error(`[FirebaseAuthState] Error writing ${id}:`, error);
        }
    };

    // Safely reads data from a Firestore document
    const readData = async (id: string) => {
        try {
            const docRef = doc(db, collectionName, fixId(id));
            const snapshot = await getDoc(docRef);
            if (snapshot.exists()) {
                let data = snapshot.data();
                
                // Unwrap if it was wrapped by writeData
                if (data && typeof data === 'object' && '_data' in data && Object.keys(data).length === 1) {
                    data = data._data;
                }
                
                return JSON.parse(JSON.stringify(data), BufferJSON.reviver);
            }
            return null;
        } catch (error) {
            console.error(`[FirebaseAuthState] Error reading ${id}:`, error);
            return null;
        }
    };

    // Deletes a specific document
    const removeData = async (id: string) => {
        try {
            const docRef = doc(db, collectionName, fixId(id));
            await deleteDoc(docRef);
        } catch (error) {
            console.error(`[FirebaseAuthState] Error removing ${id}:`, error);
        }
    };

    // Load credentials or initialize fresh ones
    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type: string, ids: string[]) => {
                    const data: { [_: string]: any } = {};
                    await Promise.all(
                        ids.map(async id => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data: any) => {
                    const tasks: Promise<void>[] = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(value, key));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => {
            return writeData(creds, 'creds');
        }
    };
};

export const clearFirestoreAuthState = async (db: any, collectionName: string) => {
    try {
        const colRef = collection(db, collectionName);
        const snapshot = await getDocs(colRef);
        const tasks = snapshot.docs.map(docSnap => deleteDoc(doc(db, collectionName, docSnap.id)));
        await Promise.all(tasks);
        console.log(`[FirebaseAuthState] Cleared all auth state documents from ${collectionName}`);
    } catch (error) {
        console.error(`[FirebaseAuthState] Error clearing auth state:`, error);
    }
};
